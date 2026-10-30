// خادم «قلّدها إذا تقدر»: HTTP + HTTPS محلي (للآيفون على نفس الشبكة) + Socket.IO + واجهات API
// في التطوير يخدم الواجهة عبر Vite، وفي الإنتاج من مجلد dist.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
import type { Duplex } from "node:stream";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server as Engine } from "engine.io";
import { Server } from "socket.io";
import { MAX_RECORDING_BYTES } from "../shared/constants";
import type { ClientToServer, ServerToClient } from "../shared/types";
import { SoundLibrary } from "./packs";
import { fileReportStore, pgReportStore, type ReportStore } from "./reports";
import { workerScorer } from "./scoring/pool";
import { attachGame } from "./socket";

const root = fileURLToPath(new URL("..", import.meta.url));
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3200;
const host = process.env.HOST || "0.0.0.0";
// HTTPS محلي مفعّل افتراضيًا في التطوير فقط (في الإنتاج يتولاه الوسيط/الاستضافة)
const httpsPort = process.env.HTTPS_PORT === "off" ? 0 : Number(process.env.HTTPS_PORT) || (dev ? 3443 : 0);
const trustProxy = process.env.TRUST_PROXY === "1" || !dev;

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."))
    .map((a) => a!.address);
}

const isLoopback = (addr: string | undefined) => !!addr && (addr === "::1" || addr.startsWith("127.") || addr === "::ffff:127.0.0.1");

/** شهادة HTTPS: من المسارات المحددة أو شهادة ذاتية التوقيع تُولَّد مرة واحدة في .cert */
async function loadCert(): Promise<{ key: string; cert: string }> {
  if (process.env.HTTPS_KEY && process.env.HTTPS_CERT) {
    return { key: readFileSync(process.env.HTTPS_KEY, "utf8"), cert: readFileSync(process.env.HTTPS_CERT, "utf8") };
  }
  const dir = resolve(root, ".cert");
  const keyFile = resolve(dir, "dev-key.pem");
  const certFile = resolve(dir, "dev-cert.pem");
  const ipsFile = resolve(dir, "ips.txt");
  const ips = ["127.0.0.1", ...lanAddresses()].sort().join(",");
  // البادئة تفرض إعادة توليد الشهادات القديمة (النسخة الأولى كانت SHA-1 ويرفضها Safari على الآيفون)
  const stamp = `sha256:${ips}`;
  if (existsSync(keyFile) && existsSync(certFile) && existsSync(ipsFile) && readFileSync(ipsFile, "utf8") === stamp) {
    return { key: readFileSync(keyFile, "utf8"), cert: readFileSync(certFile, "utf8") };
  }
  const { generate } = await import("selfsigned");
  // متطلبات iOS لشهادات TLS: توقيع SHA-2، مفتاح 2048 بت فأكثر، serverAuth، عنوان في SAN، وصلاحية ≤ 825 يومًا
  const pems = await generate([{ name: "commonName", value: "gallidha.local" }], {
    algorithm: "sha256",
    keySize: 2048,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, ...ips.split(",").map((ip) => ({ type: 7 as const, ip }))] },
    ],
  } as Parameters<typeof generate>[1]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(keyFile, pems.private);
  writeFileSync(certFile, pems.cert);
  writeFileSync(ipsFile, stamp);
  return { key: pems.private, cert: pems.cert };
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // اللعبة تستخدم المايك فقط — الكاميرا ممنوعة على مستوى المتصفح
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), display-capture=()",
  "X-Frame-Options": "DENY",
};

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; " +
  "connect-src 'self' ws: wss: data: blob:; font-src 'self' data:; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array | null> {
  return new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        resolveBody(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", () => resolveBody(null));
  });
}

async function main() {
  const sounds = new SoundLibrary(resolve(root, "public/packs"));
  const scorer = workerScorer();
  let reports: ReportStore = fileReportStore(resolve(root, process.env.REPORTS_FILE ?? "data/reports.jsonl"));
  if (process.env.DATABASE_URL) {
    try {
      reports = await pgReportStore(process.env.DATABASE_URL);
      console.log("> البلاغات تُحفظ في PostgreSQL");
    } catch (err) {
      console.warn("! تعذر الاتصال بـ PostgreSQL، البلاغات تُحفظ في ملف:", (err as Error).message);
    }
  }

  const practiceHits = new Map<string, { n: number; reset: number }>();
  let app: Handler = (_req, res) => {
    res.statusCode = 503;
    res.end("starting");
  };

  const engine = new Engine({
    pingInterval: 20_000,
    pingTimeout: 25_000,
    maxHttpBufferSize: 600_000,
    transports: ["websocket", "polling"],
  });
  const io = new Server<ClientToServer, ServerToClient>({ serveClient: false });
  io.bind(engine);
  // GAME_SPEED لتسريع مراحل اللعب في الاختبارات الآلية فقط (أطوال الأصوات الحقيقية لا تتغير)
  const speed = Math.min(1, Math.max(0.1, Number(process.env.GAME_SPEED) || 1));
  if (speed !== 1) console.log(`> وضع اختبار: سرعة المراحل ×${speed}`);
  const game = attachGame(io, { sounds, scorer, reports, trustProxy, speed, audioSpeed: 1 });

  const handle = async (req: IncomingMessage, res: ServerResponse, secure: boolean) => {
    const url = req.url ?? "/";
    if (url.startsWith("/socket.io/")) return engine.handleRequest(req, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (!dev) res.setHeader("Content-Security-Policy", CSP);
    if (secure || trustProxy) res.setHeader("Strict-Transport-Security", "max-age=15552000");
    const path = url.split("?")[0];

    if (path === "/healthz") return json(res, 200, { ok: true, rooms: game.manager.size, sounds: sounds.size });
    // عناوين الشبكة المحلية لروابط الدعوة (فقط للمتصفح على نفس الجهاز، ولا تمر عبر وسيط)
    const proxied = !!(req.headers["x-forwarded-for"] || req.headers["forwarded"] || req.headers["x-real-ip"]);
    if (path === "/lan-info" && isLoopback(req.socket.remoteAddress) && !proxied) {
      return json(res, 200, { addresses: lanAddresses(), port, httpsPort });
    }
    if (path === "/api/packs" && req.method === "GET") return json(res, 200, sounds.packs);

    // التدريب الفردي: نفس محرك التقييم على الخادم
    if (path === "/api/practice/score" && req.method === "POST") {
      const ip = (trustProxy && String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
      const hit = practiceHits.get(ip);
      if (!hit || hit.reset < Date.now()) practiceHits.set(ip, { n: 1, reset: Date.now() + 60_000 });
      else if (++hit.n > 40) return json(res, 429, { error: "rate_limited" });
      if (practiceHits.size > 5000) practiceHits.clear();
      const soundId = new URL(url, "http://x").searchParams.get("sound") ?? "";
      const def = sounds.get(soundId);
      if (!def) return json(res, 404, { error: "unknown_sound" });
      const body = await readBody(req, MAX_RECORDING_BYTES);
      if (!body) return json(res, 413, { error: "too_large" });
      const result = await scorer.score({ soundId: def.info.id, file: def.file, weights: def.weights, wav: body, maxMs: 11_000 });
      return json(res, 200, result);
    }
    app(req, res);
  };

  const httpServer = createServer((req, res) => void handle(req, res, false));
  const servers: HttpServer[] = [httpServer];
  let httpsServer: ReturnType<typeof createHttpsServer> | null = null;
  if (httpsPort) {
    try {
      httpsServer = createHttpsServer(await loadCert(), (req, res) => void handle(req, res, true));
      servers.push(httpsServer as unknown as HttpServer);
    } catch (err) {
      console.warn("! تعذر تشغيل HTTPS المحلي:", (err as Error).message);
    }
  }

  const onUpgrade = (from: "http" | "https") => (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.startsWith("/socket.io/")) return engine.handleUpgrade(req, socket, head);
    // تحديثات Vite الحية عبر HTTPS تُمرَّر لنفس معالج HTTP
    if (from === "https") httpServer.emit("upgrade", req, socket, head);
  };
  httpServer.on("upgrade", onUpgrade("http"));
  httpsServer?.on("upgrade", onUpgrade("https"));

  if (dev) {
    const { createServer: createVite } = await import("vite");
    const vite = await createVite({
      root,
      appType: "spa",
      server: { middlewareMode: true, hmr: { server: httpServer } },
    });
    app = (req, res) =>
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
  } else {
    const { default: sirv } = await import("sirv");
    app = sirv(resolve(root, "dist"), {
      single: true,
      etag: true,
      setHeaders(res, pathname) {
        const immutable = pathname.startsWith("/assets/");
        res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : pathname.startsWith("/packs/") ? "public, max-age=86400" : "no-cache");
      },
    });
  }

  const shutdown = () => {
    game.close();
    scorer.close();
    for (const s of servers) s.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  httpServer.listen(port, host, () => {
    console.log(`> قلّدها إذا تقدر جاهزة على http://localhost:${port} (${dev ? "تطوير" : "إنتاج"}) — ${sounds.size} صوت`);
  });
  httpsServer?.listen(httpsPort, host, () => {
    for (const ip of lanAddresses()) console.log(`> للجوال على نفس الشبكة (HTTPS مطلوب للمايك): https://${ip}:${httpsPort}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
