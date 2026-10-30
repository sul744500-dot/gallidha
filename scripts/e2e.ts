// اختبار شامل بمتصفحات Chrome حقيقية (بدون واجهة) — كل لاعب في متصفح مستقل بمايك وهمي يشغّل ملف صوت:
//   المضيف «سارة» يقلّد البقرة فعلًا، «فهد» (جوال) يقلّد صوتًا خاطئًا، «نورة» مايكها صامت.
// يتحقق من: صلاحيات المايك وحالات الرفض/الأخطاء، الدخول برابط الدعوة وبالكود، الدردشة الصوتية WebRTC
// وأن الكتم أثناء التسجيل فعلي في مسار البث (getStats)، التسجيل الحقيقي والتقييم والعرض والعجلة والتتويج،
// إعادة الاتصال، وإيقاف مسارات المايك عند المغادرة.
//
//   npm run build && npm run e2e        (يشغّل خادم اختبار على المنفذ 3300 تلقائيًا)
//   BASE_URL=http://localhost:3300 npm run e2e   لاستخدام خادم شغال مسبقًا

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { KnownDevices, type Browser, type Page } from "puppeteer-core";
import { imitate } from "../shared/audio/imitate";
import { resample } from "../shared/audio/resample";
import { decodeWav, encodeWav } from "../shared/audio/wav";
import type { RoomView } from "../shared/types";

const root = fileURLToPath(new URL("..", import.meta.url));
const OUT = resolve(root, process.env.SHOTS ?? "e2e-shots");
const MEDIA = resolve(root, "e2e-shots/media");
const PORT = 3300;
let BASE = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const CHROME =
  process.env.CHROME_PATH ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) =>
    existsSync(p),
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let shotNo = 0;
let failures = 0;
const results: string[] = [];

function check(ok: boolean, label: string) {
  results.push(`${ok ? "✅" : "❌"} ${label}`);
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures++;
}

async function shot(page: Page, label: string) {
  const file = join(OUT, `${String(++shotNo).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file as `${string}.png` });
  console.log(`   📸 ${file}`);
}

/** ملف WAV بـ 48kHz للمايك الوهمي (Chrome يكرره بلا نهاية) */
function makeMedia() {
  mkdirSync(MEDIA, { recursive: true });
  const load = (p: string) => decodeWav(readFileSync(resolve(root, "public/packs", p)));
  const pad = (x: Float32Array, rate: number, sec: number) => {
    const out = new Float32Array(x.length + Math.round(sec * rate));
    out.set(x);
    return out;
  };
  const cow = load("animals/cow.wav");
  const scream = load("human/scream.wav");
  const good = pad(imitate(cow.samples, cow.sampleRate, { sloppiness: 0.15, leadMs: 100, seed: 4 }), 16000, 0.6);
  const wrong = pad(imitate(scream.samples, scream.sampleRate, { sloppiness: 0.2, leadMs: 100, seed: 9 }), 16000, 1.5);
  const silent = new Float32Array(16000 * 3);
  for (let i = 0; i < silent.length; i++) silent[i] = (Math.random() * 2 - 1) * 0.0004;
  const files = { good, wrong, silent };
  const paths: Record<string, string> = {};
  for (const [k, x] of Object.entries(files)) {
    paths[k] = join(MEDIA, `${k}.wav`);
    writeFileSync(paths[k], Buffer.from(encodeWav(resample(x, 16000, 48000), 48000)));
  }
  // نسخ بدون صمت إضافي للمايك الافتراضي (يبدأ التقليد مع «قلّد!» مثل اللاعب الحقيقي)
  paths.goodTake = join(MEDIA, "good-take.wav");
  writeFileSync(paths.goodTake, Buffer.from(encodeWav(imitate(cow.samples, cow.sampleRate, { sloppiness: 0.15, leadMs: 0, seed: 4 }), 16000)));
  paths.wrongTake = join(MEDIA, "wrong-take.wav");
  writeFileSync(paths.wrongTake, Buffer.from(encodeWav(imitate(scream.samples, scream.sampleRate, { sloppiness: 0.2, leadMs: 0, seed: 9 }), 16000)));
  return paths;
}

/**
 * مايك افتراضي للاختبار: يستبدل مصدر getUserMedia بمسار Web Audio حقيقي
 * (كل ما بعده — مسار الدردشة WebRTC، الالتقاط بـ AudioWorklet، الترميز، الرفع، التقييم — هو كود اللعبة الحقيقي).
 * في اللوبي يبث «كلامًا» صناعيًا للدردشة، ومع بدء التسجيل يشغّل التقليد بعد زمن رد فعل بشري.
 */
async function virtualMic(page: Page, takeFile: string | null, chatter: boolean) {
  const b64 = takeFile ? readFileSync(takeFile).toString("base64") : null;
  await page.evaluateOnNewDocument(
    (take, chatterOn) => {
      type W = { __gallidha?: { director: { get(): { recording: boolean } }; recorder: { recording: boolean }; game: { view: { phase: string } | null } } };
      const w = window as unknown as W;
      navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
        if (c?.video) throw new DOMException("camera is not allowed", "NotAllowedError");
        const ctx = new AudioContext();
        await ctx.resume();
        const dest = ctx.createMediaStreamDestination();
        // «كلام» صناعي: مذبذب بتعديل سعة (amp) ثم مفتاح تشغيل/إيقاف مستقل (talk)
        const amp = ctx.createGain();
        amp.gain.value = 0.5;
        const talk = ctx.createGain();
        talk.gain.value = 0;
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = 170;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 3.5;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.5;
        lfo.connect(lfoGain).connect(amp.gain);
        osc.connect(amp).connect(talk).connect(dest);
        osc.start();
        lfo.start();
        let buffer: AudioBuffer | null = null;
        if (take) buffer = await ctx.decodeAudioData(Uint8Array.from(atob(take), (ch) => ch.charCodeAt(0)).buffer);
        let was = false;
        let lastChat = false;
        setInterval(() => {
          const phase = w.__gallidha?.game.view?.phase;
          const rec = !!(w.__gallidha?.director.get().recording || w.__gallidha?.recorder.recording);
          const chatting = chatterOn && (phase === "lobby" || phase === "leaderboard" || phase === "final");
          if (chatting !== lastChat) {
            lastChat = chatting;
            talk.gain.value = chatting ? 0.3 : 0;
          }
          if (rec && !was && buffer) {
            const s = ctx.createBufferSource();
            s.buffer = buffer;
            s.connect(dest);
            s.start(ctx.currentTime + 0.3);
          }
          was = rec;
        }, 15);
        return dest.stream;
      };
    },
    b64,
    chatter,
  );
}

async function startServer(): Promise<ChildProcess | null> {
  if (process.env.BASE_URL) return null;
  const prod = existsSync(resolve(root, "dist/index.html"));
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), HTTPS_PORT: "off", GAME_SPEED: "0.4", FORCE_SOUND: "animals/cow", NODE_ENV: prod ? "production" : "development", REPORTS_FILE: "e2e-shots/reports.jsonl" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[server] ${d}`));
  child.stderr?.on("data", (d) => process.stdout.write(`[server!] ${d}`));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) {
        console.log(`> خادم الاختبار جاهز (${prod ? "إنتاج" : "تطوير"}) على ${BASE}`);
        return child;
      }
    } catch {
      /* ننتظر */
    }
    await sleep(500);
  }
  throw new Error("server did not start");
}

async function launch(audio: string | null, extra: string[] = []): Promise<Browser> {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 120_000,
    args: [
      ...(audio ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${audio}`] : []),
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      "--no-first-run",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      ...extra,
    ],
  });
}

interface Player {
  name: string;
  page: Page;
  errors: string[];
}

async function open(browser: Browser, name: string, url: string, mobile = false, graphics: "low" | "off" = "off", prepare?: (page: Page) => Promise<void>): Promise<Player> {
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  if (mobile) await page.emulate(KnownDevices["iPhone 13"]);
  else await page.setViewport({ width: 1280, height: 800 });
  const p: Player = { name, page, errors: [] };
  page.on("pageerror", (e) => p.errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|ERR_|WebGL|GPU stall/i.test(m.text()) && p.errors.push(m.text()));
  page.on("dialog", (d) => void d.accept());
  await page.evaluateOnNewDocument((g) => {
    try {
      localStorage.setItem("gallidha.prefs.v1", JSON.stringify({ graphics: g, sfxVolume: 0.2 }));
    } catch {
      /* ignore */
    }
  }, graphics);
  if (prepare) await prepare(page);
  await page.goto(url, { waitUntil: "networkidle2" });
  return p;
}

async function clickText(page: Page, text: string, timeout = 15000) {
  const h = await page.waitForFunction(
    (txt) =>
      [...document.querySelectorAll<HTMLElement>("button")].find((e) => e.innerText.includes(txt) && !(e as HTMLButtonElement).disabled && e.getClientRects().length > 0),
    { timeout },
    text,
  );
  await (h as unknown as { click(): Promise<void> }).click();
}

async function hasText(page: Page, text: string, timeout = 10000): Promise<boolean> {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
    return true;
  } catch {
    return false;
  }
}

const view = (page: Page) => page.evaluate(() => (window as unknown as { __gallidha?: { game: { view: RoomView | null } } }).__gallidha?.game.view ?? null);

async function waitView(page: Page, pred: string, timeout = 60000): Promise<RoomView> {
  await page.waitForFunction(`(() => { const v = window.__gallidha?.game.view; return !!v && (${pred}); })()`, { timeout, polling: 100 });
  return (await view(page))!;
}

/** أعلى مستوى صوت (RMS) وصل فعليًا عبر WebRTC من لاعب خلال فترة — يُقاس من الإشارة المستقبَلة قبل أي قفل محلي */
async function received(page: Page, fromId: string, ms = 1500): Promise<{ state: string; peak: number; bytes: number }> {
  return page.evaluate(
    async (id, dur) => {
      const g = (window as unknown as { __gallidha: { voice: { rawLevel(i: string): number; stats(): Promise<Record<string, { state: string; bytes: number }>> } } }).__gallidha;
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < dur) {
        peak = Math.max(peak, g.voice.rawLevel(id));
        await new Promise((r) => setTimeout(r, 40));
      }
      const st = (await g.voice.stats())[id];
      return { state: st?.state ?? "none", peak, bytes: st?.bytes ?? 0 };
    },
    fromId,
    ms,
  );
}

/** يتخطى شاشة الترحيب إن ظهرت (التنقل داخل نفس الصفحة لا يعيد عرضها) */
async function maybeGate(p: Player) {
  const gate = await hasText(p.page, "ابدأ اللعب", 2500);
  if (gate) await clickText(p.page, "ابدأ اللعب");
  await sleep(400);
}

async function passGate(p: Player, label: string, expectCheck = true) {
  await clickText(p.page, "ابدأ اللعب");
  if (expectCheck) {
    const heard = await hasText(p.page, "اختبار المايك", 15000);
    check(heard, `${p.name}: نافذة الصلاحية قُبلت وظهر اختبار المايك`);
    if (label) await shot(p.page, label);
    await clickText(p.page, "تمام، كمّل");
  }
}

async function scenarioPermissions() {
  console.log("\n— صلاحيات المايك: رفض وأخطاء الأجهزة —");
  // 1) رفض الصلاحية (Chrome بدون موافقة تلقائية يرفض الطلب)
  const b1 = await launch(null, ["--deny-permission-prompts", "--use-fake-device-for-media-stream"]);
  const p1 = await open(b1, "رافض", `${BASE}/?debug=1`);
  await clickText(p1.page, "ابدأ اللعب");
  check(await hasText(p1.page, "رفضت صلاحية المايك"), "رفض الصلاحية → رسالة واضحة + تعليمات إعادة التفعيل");
  check(await p1.page.evaluate(() => document.body.innerText.includes("NotAllowedError")), "رمز الخطأ NotAllowedError ظاهر");
  await shot(p1.page, "mic-denied");
  await clickText(p1.page, "تابع بدون مايك");
  check(await hasText(p1.page, "المايك متوقف"), "المشاهدة بدون مايك متاحة");
  await b1.close();

  // 2) أخطاء الأجهزة المختلفة (نحاكي استجابة المتصفح لكل حالة)
  for (const [name, expect] of [
    ["NotFoundError", "ما لقينا مايك"],
    ["NotReadableError", "المايك مشغول"],
    ["OverconstrainedError", "اختبار المايك"],
  ] as const) {
    const b = await launch(null, ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]);
    const page = (await b.pages())[0];
    await page.evaluateOnNewDocument((errName) => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let calls = 0;
      navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => {
        calls++;
        // OverconstrainedError: نرفض أول محاولة فقط لنتأكد من إعادة المحاولة بإعدادات أبسط
        if (errName !== "OverconstrainedError" || calls === 1) return Promise.reject(new DOMException("simulated", errName));
        return real(c);
      };
    }, name);
    const p = await open(b, name, `${BASE}/?debug=1`);
    await clickText(p.page, "ابدأ اللعب");
    check(await hasText(p.page, expect), `${name} → «${expect}»`);
    await b.close();
  }

  // 3) الكاميرا لا تُطلب أبدًا
  const b3 = await launch(null, ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]);
  const page3 = (await b3.pages())[0];
  await page3.evaluateOnNewDocument(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as unknown as { __constraints: unknown[] }).__constraints = [];
    navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => {
      (window as unknown as { __constraints: unknown[] }).__constraints.push(c);
      return real(c);
    };
  });
  const p3 = await open(b3, "كاميرا", `${BASE}/?debug=1`);
  await clickText(p3.page, "ابدأ اللعب");
  await hasText(p3.page, "اختبار المايك");
  check(await hasText(p3.page, "سامعينك", 10000), "مايك Chrome الوهمي (جهاز حقيقي من منظور المتصفح) يُلتقط فعلًا: مؤشر المستوى تحرك");
  const constraints = await p3.page.evaluate(() => JSON.stringify((window as unknown as { __constraints: unknown[] }).__constraints));
  check(/"video":false/.test(constraints) && !/"video":\{/.test(constraints), `getUserMedia يطلب الصوت فقط: ${constraints.slice(0, 160)}`);
  const pp = await fetch(BASE).then((r) => r.headers.get("permissions-policy"));
  check(!!pp && pp.includes("camera=()"), `ترويسة Permissions-Policy تمنع الكاميرا: ${pp}`);
  await b3.close();
}

async function scenarioMatch(media: Record<string, string>) {
  console.log("\n— مباراة كاملة: 3 لاعبين في 3 متصفحات —");
  const bHost = await launch(null);
  const bGuest = await launch(null);
  const bQuiet = await launch(null);
  try {
    const host = await open(bHost, "سارة", `${BASE}/?debug=1`, false, "low", (pg) => virtualMic(pg, media.goodTake, true));
    await shot(host.page, "gate-desktop");
    await passGate(host, "mic-check");
    await clickText(host.page, "إنشاء غرفة");
    await host.page.locator("input[autocomplete=nickname]").fill("سارة");
    await clickText(host.page, "4");
    await shot(host.page, "create-room");
    await clickText(host.page, "أنشئ الغرفة");
    const lobby = await waitView(host.page, "v.phase === 'lobby'");
    check(/^\d{6}$/.test(lobby.code), `أُنشئت غرفة بكود ${lobby.code}`);
    const hostId = await host.page.evaluate(() => (window as unknown as { __gallidha: { game: { me: string } } }).__gallidha.game.me);

    // فهد: جوال، يدخل برابط الدعوة
    const guest = await open(bGuest, "فهد", `${BASE}/?r=${lobby.code}&debug=1`, true, "off", (pg) => virtualMic(pg, media.wrongTake, true));
    await shot(guest.page, "gate-mobile");
    await passGate(guest, "");
    check(await guest.page.evaluate((c) => (document.querySelector("input[inputmode=numeric]") as HTMLInputElement)?.value === c, lobby.code), "رابط الدعوة عبّأ كود الغرفة تلقائيًا");
    await guest.page.locator("input[autocomplete=nickname]").fill("فهد");
    await clickText(guest.page, "ادخل");
    await waitView(guest.page, "v.players.length >= 2");

    // نورة: تكتب الكود يدويًا
    const quiet = await open(bQuiet, "نورة", `${BASE}/?debug=1`, false, "off", (pg) => virtualMic(pg, null, false));
    await passGate(quiet, "");
    await clickText(quiet.page, "الانضمام إلى غرفة");
    await quiet.page.locator("input[inputmode=numeric]").fill(lobby.code);
    await quiet.page.locator("input[autocomplete=nickname]").fill("نورة");
    await clickText(quiet.page, "ادخل");
    const v3 = await waitView(host.page, "v.players.length === 3");
    check(v3.players.length === 3, "ثلاثة لاعبين في نفس الغرفة من ثلاثة متصفحات");

    // الدردشة الصوتية: فهد يسمع سارة فعلًا في اللوبي
    let lvl = { state: "none", peak: 0, bytes: 0 };
    for (let i = 0; i < 30; i++) {
      lvl = await received(guest.page, hostId, 800);
      if (lvl.state === "connected" && lvl.peak > 0.02) break;
    }
    check(lvl.state === "connected", `اتصال WebRTC صوتي مباشر بين المتصفحين: ${lvl.state} (${lvl.bytes} بايت)`);
    check(lvl.peak > 0.02, `صوت سارة يصل لفهد عبر الشبكة في اللوبي (RMS=${lvl.peak.toFixed(3)})`);

    // كتم يدوي: عند كتم سارة لمايكها يتوقف وصول صوتها عبر الشبكة نفسها
    await host.page.evaluate(() => (window as unknown as { __gallidha: { mic: { setMuted(m: boolean): void } } }).__gallidha.mic.setMuted(true));
    await sleep(600);
    const mutedLvl = await received(guest.page, hostId, 2500);
    check(mutedLvl.peak < 0.005, `الكتم فعلي في البث: الصوت الواصل من سارة لفهد أثناء كتمها RMS=${mutedLvl.peak.toFixed(4)}`);
    const shownMuted = await waitView(guest.page, `v.players.find(p => p.id === '${hostId}')?.mic === 'muted'`, 10000).then(
      () => true,
      () => false,
    );
    check(shownMuted, "حالة «مكتوم» تظهر عند الآخرين");
    await host.page.evaluate(() => (window as unknown as { __gallidha: { mic: { setMuted(m: boolean): void } } }).__gallidha.mic.setMuted(false));
    await shot(host.page, "lobby-desktop");
    await shot(guest.page, "lobby-mobile");

    await clickText(guest.page, "أنا جاهز");
    await clickText(quiet.page, "أنا جاهز");
    await waitView(host.page, "v.players.filter(p => p.ready).length === 2");
    await clickText(host.page, "ابدأ المباراة");

    const listen = await waitView(host.page, "v.phase === 'listen'", 30000);
    check(listen.sound?.id === "animals/cow" && listen.round === 1, `الجولة 1 بدأت والصوت المرجعي: ${listen.sound?.id}`);
    await sleep(700);
    await shot(host.page, "listen");

    await waitView(host.page, "v.phase === 'record'", 30000);
    await sleep(900);
    const recording = await host.page.evaluate(() => (window as unknown as { __gallidha: { director: { get(): { recording: boolean } } } }).__gallidha.director.get().recording);
    check(recording, "التسجيل بدأ فعليًا عند سارة لحظة «قلّد!»");
    const lockedLvl = await received(guest.page, hostId, 1500);
    const vRec = (await view(guest.page))!;
    check(vRec.voiceOpen === false && lockedLvl.peak < 0.005, `الدردشة مقفلة فعليًا أثناء التسجيل: الصوت الواصل عبر الشبكة RMS=${lockedLvl.peak.toFixed(4)}`);
    await shot(host.page, "record-desktop");
    await shot(guest.page, "record-mobile");

    const rev = await waitView(host.page, "v.phase === 'reveal' && v.reveal.step === 'score'", 40000);
    await sleep(1300);
    await shot(host.page, "reveal-score");
    check(!!rev.reveal?.current?.result, "ظهرت درجة أول تسجيل بعد تشغيله");

    const lb = await waitView(host.page, "v.phase === 'leaderboard'", 60000);
    const byName = (n: string) => lb.leaderboard!.find((e) => lb.players.find((p) => p.id === e.playerId)?.name === n)!;
    const eHost = byName("سارة");
    const eGuest = byName("فهد");
    const eQuiet = byName("نورة");
    console.log(`   الدرجات: سارة=${eHost.status}/${eHost.score} فهد=${eGuest.status}/${eGuest.score} نورة=${eQuiet.status}/${eQuiet.score}`);
    check(eHost.status === "ok" && eHost.score !== null, "تقليد سارة الحقيقي (من المايك) أخذ درجة محسوبة");
    check(eQuiet.status === "silent" && eQuiet.score === null && eQuiet.points === 0, "مايك نورة الصامت → «صامت» بدون درجة مخترعة");
    check((eHost.score ?? 0) > (eGuest.score ?? 0), `تقليد البقرة (${eHost.score}) أعلى من تقليد صوت خاطئ (${eGuest.score})`);
    await shot(host.page, "leaderboard");

    // إعادة الاتصال: فهد يحدّث الصفحة أثناء المباراة ويرجع
    await waitView(host.page, "v.phase === 'wheel' || (v.phase === 'intro' && v.round === 2)", 40000);
    await shot(host.page, "wheel");
    await guest.page.reload({ waitUntil: "networkidle2" });
    check(await hasText(guest.page, "راجع لغرفة"), "بعد التحديث: شاشة الترحيب تعرض الرجوع للغرفة");
    await clickText(guest.page, "ابدأ اللعب");
    const back = await waitView(guest.page, `v.players.find(p => p.name === 'فهد')?.connected === true`, 20000);
    check(back.code === lobby.code, "فهد رجع لنفس الغرفة بعد التحديث (إعادة الاتصال)");

    const fin = await waitView(host.page, "v.phase === 'final'", 300000);
    await sleep(1500);
    await shot(host.page, "final-desktop");
    await shot(guest.page, "final-mobile");
    check(fin.final?.ranking.length === 3, "التتويج: ترتيب نهائي لثلاثة لاعبين");
    check(fin.final!.ranking[fin.final!.ranking.length - 1].name === "نورة", "صاحبة المايك الصامت في المركز الأخير");
    check(!!fin.final?.best, `أفضل تقليد: ${fin.final?.best?.value}/100`);
    const totals = await Promise.all([host, guest, quiet].map(async (p) => JSON.stringify((await view(p.page))?.players.map((x) => x.score))));
    check(new Set(totals).size === 1, `النقاط متزامنة على كل الأجهزة: ${totals[0]}`);

    // المغادرة توقف المايك فعليًا
    await guest.page.evaluate(() => {
      (window as unknown as { __track: MediaStreamTrack | null }).__track = (window as unknown as { __gallidha: { mic: { recTrack: MediaStreamTrack | null } } }).__gallidha.mic.recTrack;
    });
    await guest.page.click("button[aria-label='مغادرة']");
    await sleep(800);
    const ended = await guest.page.evaluate(() => (window as unknown as { __track: MediaStreamTrack | null }).__track?.readyState);
    check(ended === "ended", `بعد المغادرة: مسار المايك متوقف (${ended})`);

    for (const p of [host, guest, quiet]) check(p.errors.length === 0, `${p.name}: لا أخطاء JavaScript ${p.errors.slice(0, 2).join(" | ")}`);
  } finally {
    await Promise.all([bHost.close(), bGuest.close(), bQuiet.close()]);
  }
}

async function scenarioExtras(media: Record<string, string>) {
  console.log("\n— المكتبة، التدريب الفردي، الإنجليزية، العب الآن —");
  const b = await launch(null);
  try {
    const p = await open(b, "متدرب", `${BASE}/?debug=1`, false, "low", (pg) => virtualMic(pg, media.goodTake, false));
    await passGate(p, "");
    await shot(p.page, "home");
    await clickText(p.page, "مكتبة الأصوات");
    await p.page.waitForFunction(() => document.body.innerText.includes("تدرّب"), { timeout: 15000 });
    const count = await p.page.evaluate(() => [...document.querySelectorAll("button")].filter((x) => x.innerText.includes("تدرّب")).length);
    check(count === 30, `مكتبة الأصوات تعرض ${count} صوت أصلي (5 باقات)`);
    await shot(p.page, "library");
    const packs = (await fetch(`${BASE}/api/packs`).then((r) => r.json())) as { sounds: { url: string }[] }[];
    const wav = await fetch(BASE + packs[0].sounds[0].url);
    check(wav.ok && (await wav.arrayBuffer()).byteLength > 20000, "ملفات الأصوات حقيقية وقابلة للتشغيل (WAV)");
    await p.page.goto(`${BASE}/?debug=1#/solo?sound=animals/cow`, { waitUntil: "networkidle2" });
    await maybeGate(p);
    await clickText(p.page, "سجّل تقليدك");
    await p.page.waitForFunction(() => document.body.innerText.includes("التشابه العام") || document.body.innerText.includes("ما انحسب"), { timeout: 40000 });
    await sleep(1400);
    const soloScore = await p.page.evaluate(() => Number(document.body.innerText.match(/(\d+)\s*\/100/)?.[1] ?? -1));
    check(soloScore >= 60, `التدريب الفردي: تقليد البقرة قُيّم على الخادم بـ ${soloScore}/100`);
    await sleep(1300);
    await shot(p.page, "solo-result");
    await p.page.click("button[aria-label='الإعدادات']");
    await clickText(p.page, "English");
    const en = await p.page.evaluate(() => ({ dir: document.documentElement.dir, txt: document.body.innerText.includes("Settings") }));
    check(en.dir === "ltr" && en.txt, "التبديل للإنجليزية يعمل (اتجاه LTR)");
    await shot(p.page, "settings-en");
    await clickText(p.page, "العربية");
    await p.page.keyboard.press("Escape");
    await p.page.goto(`${BASE}/?debug=1#/create`, { waitUntil: "networkidle2" });
    await maybeGate(p);
    await p.page.locator("input[autocomplete=nickname]").fill("سريع");
    await p.page.goto(`${BASE}/?debug=1#/`, { waitUntil: "networkidle2" });
    await maybeGate(p);
    await clickText(p.page, "العب الآن");
    const quick = await waitView(p.page, "v.phase === 'lobby'", 15000).then(
      () => true,
      () => false,
    );
    check(quick, "«العب الآن» ينشئ غرفة بضغطة واحدة");
    check(p.errors.length === 0, `لا أخطاء JavaScript ${p.errors.slice(0, 2).join(" | ")}`);
  } finally {
    await b.close();
  }
}

async function main() {
  if (!CHROME) throw new Error("Chrome/Edge not found — set CHROME_PATH");
  mkdirSync(OUT, { recursive: true });
  const media = makeMedia();
  const server = await startServer();
  try {
    if (!process.env.ONLY || process.env.ONLY === "perm") await scenarioPermissions();
    if (!process.env.ONLY || process.env.ONLY === "extras") await scenarioExtras(media);
    if (!process.env.ONLY || process.env.ONLY === "match") await scenarioMatch(media);
  } finally {
    server?.kill();
  }
  console.log(`\n${results.filter((r) => r.startsWith("✅")).length} نجح، ${failures} فشل`);
  writeFileSync(join(OUT, "results.txt"), results.join("\n") + "\n");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
