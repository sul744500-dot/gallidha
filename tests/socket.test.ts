import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "socket.io";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { SoundLibrary } from "../server/packs";
import { memoryReportStore } from "../server/reports";
import { inlineScorer } from "../server/scoring/pool";
import { attachGame } from "../server/socket";
import { imitate } from "../shared/audio/imitate";
import { decodeWav, encodeWav } from "../shared/audio/wav";
import { SAMPLE_RATE } from "../shared/constants";
import type { ClientToServer, JoinResult, Phase, RoomSettings, RoomView, RtcData, ServerToClient } from "../shared/types";

const root = fileURLToPath(new URL("..", import.meta.url));
const sounds = new SoundLibrary(resolve(root, "public/packs"));
const reports = memoryReportStore();
let url = "";
let close: () => void;
let game: ReturnType<typeof attachGame>;

beforeAll(async () => {
  const http = createServer();
  const io = new Server<ClientToServer, ServerToClient>(http, { maxHttpBufferSize: 600_000 });
  game = attachGame(io, { sounds, scorer: inlineScorer(), reports, speed: 0.06, perSecond: 200, burst: 400 });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  close = () => {
    game.close();
    io.close();
    http.close();
  };
});
afterAll(() => close?.());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Style = "good" | "silent" | "muted" | "none" | "wrong";

class Bot {
  socket: ClientSocket<ServerToClient, ClientToServer>;
  view: RoomView | null = null;
  views: RoomView[] = [];
  me = "";
  token = "";
  code = "";
  kicked = "";
  signals: { from: string; data: RtcData }[] = [];
  recordings = new Map<string, number>();
  uploadedRound = 0;
  constructor(
    public name: string,
    public style: Style = "good",
    public device = `dev-${Math.random().toString(36).slice(2, 12)}`,
  ) {
    this.socket = connect(url, { transports: ["websocket"], forceNew: true });
    this.socket.on("room:state", (v) => {
      this.view = v;
      this.views.push(v);
      this.react(v);
    });
    this.socket.on("room:kicked", (r) => (this.kicked = r));
    this.socket.on("rtc:signal", (s) => this.signals.push(s));
    this.socket.on("game:recording", (r) => {
      this.recordings.set(`${r.round}:${r.playerId}`, (r.wav as unknown as Buffer).byteLength);
      const v = this.view;
      if (v && [...this.recordings.keys()].filter((k) => k.startsWith(`${r.round}:`)).length >= v.participants.filter((id) => v.players.some((p) => p.id === id)).length - 1)
        this.socket.emit("game:loaded", { round: r.round, what: "recordings" });
    });
  }

  private react(v: RoomView) {
    if (v.phase === "intro") this.socket.emit("game:loaded", { round: v.round, what: "sound" });
    if (v.phase === "record" && v.participants.includes(this.me) && this.uploadedRound !== v.round && v.record) {
      this.uploadedRound = v.round;
      const delay = Math.max(0, v.record.endAt - v.now);
      const round = v.round;
      const soundUrl = v.sound!.url;
      setTimeout(() => this.upload(round, soundUrl), delay);
    }
    if (v.phase === "collect") this.socket.emit("game:loaded", { round: v.round, what: "recordings" });
    if (v.phase === "wheel" && v.wheel?.stage === "pick" && v.wheel.spinnerId === this.me) {
      const target = v.players.find((p) => p.id !== this.me);
      if (target) setTimeout(() => this.socket.emit("wheel:pick", target.id), 5);
    }
    if (v.phase === "vote" && v.participants.includes(this.me) && !v.vote?.voters.includes(this.me)) {
      const target = v.participants.find((id) => id !== this.me);
      if (target) this.socket.emit("game:vote", target);
    }
  }

  private upload(round: number, soundUrl: string) {
    if (this.style === "none") return;
    if (this.style === "muted") return this.socket.emit("game:upload", { round, wav: new ArrayBuffer(0), mutedAll: true });
    let samples: Float32Array;
    if (this.style === "silent") samples = new Float32Array(SAMPLE_RATE * 2);
    else {
      const file = this.style === "wrong" ? "/packs/human/scream.wav" : soundUrl;
      const d = decodeWav(readFileSync(resolve(root, "public" + file)));
      samples = imitate(d.samples, d.sampleRate, { sloppiness: 0.2, seed: this.name.length });
    }
    this.socket.emit("game:upload", { round, wav: encodeWav(samples, SAMPLE_RATE), mutedAll: false });
  }

  async ready() {
    if (!this.socket.connected) await new Promise((r) => this.socket.once("connect", () => r(null)));
  }

  async create(settings: Partial<RoomSettings> = {}): Promise<JoinResult> {
    await this.ready();
    const r = await this.socket.emitWithAck("room:create", { roomName: "اختبار", name: this.name, avatar: { color: 1, hat: 2, eyes: 0 }, settings, mic: "on", device: this.device });
    if (r.ok) Object.assign(this, { me: r.playerId, token: r.token, code: r.code });
    return r;
  }

  async join(code: string, mic: "on" | "denied" = "on"): Promise<JoinResult> {
    await this.ready();
    const r = await this.socket.emitWithAck("room:join", { code, name: this.name, avatar: { color: 3, hat: 1, eyes: 1 }, mic, device: this.device });
    if (r.ok) Object.assign(this, { me: r.playerId, token: r.token, code: r.code });
    return r;
  }

  async until(pred: (v: RoomView) => boolean, timeout = 20000): Promise<RoomView> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (this.view && pred(this.view)) return this.view;
      await wait(10);
    }
    throw new Error(`${this.name}: timeout waiting; phase=${this.view?.phase}`);
  }

  phases(): Phase[] {
    return this.views.map((v) => v.phase).filter((p, i, a) => i === 0 || a[i - 1] !== p);
  }

  disconnect() {
    this.socket.disconnect();
  }
}

describe("الغرف واللعب الجماعي عبر Socket.IO", () => {
  it("مباراة كاملة: إنشاء، دعوة، جاهزية، جولتان، عجلة، تتويج", async () => {
    const host = new Bot("سارة");
    const created = await host.create({ rounds: 4, wheel: true, revealOrder: "fixed", maxPlayers: 4 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.code).toMatch(/^\d{6}$/);
    expect(created.ice.length).toBeGreaterThan(0);

    const b = new Bot("فهد");
    const c = new Bot("نورة", "silent");
    expect((await b.join(created.code)).ok).toBe(true);
    expect((await c.join(created.code)).ok).toBe(true);
    await host.until((v) => v.players.length === 3);
    b.socket.emit("room:ready", true);
    c.socket.emit("room:ready", true);
    await host.until((v) => v.players.filter((p) => p.ready).length === 2);

    // غير المضيف لا يستطيع البدء
    expect((await b.socket.emitWithAck("room:start")).ok).toBe(false);
    expect((await host.socket.emitWithAck("room:start")).ok).toBe(true);

    const final = await host.until((v) => v.phase === "final", 60000);
    expect(final.final?.reason).toBe("completed");
    expect(final.final?.ranking.length).toBe(3);
    // اللاعب الذي قلّد فعلًا يتفوق على صاحب التسجيل الصامت
    const silentEntry = final.final!.ranking.find((r) => r.name === "نورة")!;
    expect(final.final!.best).not.toBeNull();
    expect(final.final!.ranking[0].score).toBeGreaterThan(silentEntry.score);

    const seq = host.phases();
    for (const p of ["intro", "listen", "countdown", "record", "collect", "reveal", "leaderboard", "wheel", "final"] as Phase[]) expect(seq).toContain(p);

    // الدردشة الصوتية مقفلة أثناء الاستماع والتسجيل وتشغيل التسجيلات، ومفتوحة عند عرض الدرجة
    for (const v of host.views) {
      if (["listen", "countdown", "record"].includes(v.phase)) expect(v.voiceOpen).toBe(false);
      if (v.phase === "reveal" && v.reveal?.step === "play") expect(v.voiceOpen).toBe(false);
      if (v.phase === "reveal" && v.reveal?.step === "score") expect(v.voiceOpen).toBe(true);
      if (v.phase === "lobby" || v.phase === "leaderboard") expect(v.voiceOpen).toBe(true);
    }

    // السرية: لا درجة قبل خطوة العرض، ولا نوع تخريب قبل التشغيل
    for (const v of [...host.views, ...b.views]) {
      if (v.reveal?.current && v.reveal.step !== "score") expect(v.reveal.current.result).toBeNull();
      if (v.reveal?.step === "intro") expect(v.reveal.current?.sabotage).toBeNull();
      if (v.phase !== "leaderboard") expect(v.leaderboard).toBeNull();
      expect(JSON.stringify(v)).not.toContain("token");
    }

    // الصامت يحصل على حالة «صامت» بدل درجة مخترعة
    const silentResults = host.views.flatMap((v) => v.reveal?.done ?? []).filter((e) => e.playerId === c.me);
    expect(silentResults.length).toBeGreaterThan(0);
    for (const e of silentResults) {
      expect(e.status).toBe("silent");
      expect(e.score).toBeNull();
      expect(e.points).toBe(0);
    }
    // التسجيلات الحقيقية وصلت لكل اللاعبين للتشغيل
    expect([...b.recordings.keys()].some((k) => k.endsWith(`:${host.me}`))).toBe(true);

    // العودة للغرفة ثم مباراة جديدة بنفس اللاعبين
    host.socket.emit("room:lobby");
    const lobby = await host.until((v) => v.phase === "lobby");
    expect(lobby.players.every((p) => p.score === 0)).toBe(true);
    [host, b, c].forEach((x) => x.disconnect());
  }, 90000);

  it("وضع الضحك: تصويت بدون التصويت للنفس + نقاط التصويت", async () => {
    const a = new Bot("أ");
    const r = await a.create({ rounds: 4, mode: "laugh", wheel: false });
    if (!r.ok) throw new Error("create failed");
    const b = new Bot("ب");
    const c = new Bot("ج");
    await b.join(r.code);
    await c.join(r.code);
    await a.until((v) => v.players.length === 3);
    await a.socket.emitWithAck("room:start");
    const lb = await a.until((v) => v.phase === "leaderboard" && !!v.vote?.tally);
    const tally = lb.vote!.tally!;
    expect(Object.values(tally).reduce((x, y) => x + y, 0)).toBe(3);
    const voted = lb.leaderboard!.filter((e) => e.votes > 0);
    expect(voted.length).toBeGreaterThan(0);
    for (const e of voted) expect(e.voteBonus).toBe(e.votes * 20);
    expect(a.phases()).toContain("vote");
    expect(a.phases()).not.toContain("wheel");
    [a, b, c].forEach((x) => x.disconnect());
  }, 60000);

  it("إعادة الاتصال، نقل المضيف، الطرد ومنع العودة، تمرير إشارات WebRTC داخل الغرفة فقط", async () => {
    const host = new Bot("مضيف");
    const r = await host.create();
    if (!r.ok) throw new Error("create failed");
    const b = new Bot("ضيف");
    const c = new Bot("مزعج");
    await b.join(r.code);
    await c.join(r.code);

    // إشارات WebRTC
    host.socket.emit("rtc:signal", { to: b.me, data: { type: "candidate", candidate: null } });
    await wait(80);
    expect(b.signals).toEqual([{ from: host.me, data: { type: "candidate", candidate: null } }]);
    const outsider = new Bot("خارجي");
    const other = await outsider.create();
    expect(other.ok).toBe(true);
    outsider.socket.emit("rtc:signal", { to: b.me, data: { type: "candidate", candidate: null } });
    await wait(80);
    expect(b.signals.length).toBe(1);

    // إعادة الاتصال بنفس الرمز
    b.disconnect();
    await host.until((v) => v.players.find((p) => p.id === b.me)?.connected === false);
    const b2 = new Bot("ضيف");
    await b2.ready();
    const resumed = await b2.socket.emitWithAck("room:resume", { code: r.code, playerId: b.me, token: b.token, mic: "muted" });
    expect(resumed.ok && resumed.playerId).toBe(b.me);
    const v1 = await host.until((v) => v.players.find((p) => p.id === b.me)?.connected === true);
    expect(v1.players.find((p) => p.id === b.me)?.mic).toBe("muted");
    // رمز خاطئ
    const bad = await b2.socket.emitWithAck("room:resume", { code: r.code, playerId: b.me, token: "nope", mic: "on" });
    expect(bad.ok).toBe(false);

    // الطرد ومنع العودة بنفس الجهاز
    host.socket.emit("room:kick", c.me);
    await wait(80);
    expect(c.kicked).toBe("kicked");
    const again = await c.join(r.code);
    expect(again.ok === false && again.error).toBe("kicked");

    // المضيف يغادر → تنتقل الإدارة تلقائيًا
    await host.socket.emitWithAck("room:leave");
    const v2 = await b2.until((v) => v.hostId === b.me);
    expect(v2.players.length).toBe(1);

    // البلاغ يُحفظ بدون بيانات صوتية
    const d = new Bot("مبلّغ");
    await d.join(r.code);
    const rep = await d.socket.emitWithAck("player:report", { playerId: b.me, reason: "كلام مسيء" });
    expect(rep.ok).toBe(true);
    expect(reports.items.at(-1)).toMatchObject({ room: r.code, targetId: b.me, reason: "كلام مسيء" });

    // كود غير صحيح
    const nf = await d.socket.emitWithAck("room:join", { code: "000000", name: "x", avatar: { color: 0, hat: 0, eyes: 0 }, mic: "on", device: "abcdefgh12" });
    expect(nf.ok).toBe(false);
    [host, b2, c, d, outsider].forEach((x) => x.disconnect());
  }, 30000);

  it("لا تبدأ مباراة بدون مايكين يعملان، والمكتوم طوال التسجيل يأخذ «مكتوم»", async () => {
    const a = new Bot("واحد");
    const r = await a.create({ rounds: 4, wheel: false });
    if (!r.ok) throw new Error("create failed");
    const noMic = new Bot("بلا مايك");
    await noMic.join(r.code, "denied");
    await a.until((v) => v.players.length === 2);
    const fail = await a.socket.emitWithAck("room:start");
    expect(fail.ok === false && fail.error).toBe("not_enough");
    const m = new Bot("مكتوم", "muted");
    await m.join(r.code);
    await a.until((v) => v.players.length === 3);
    expect((await a.socket.emitWithAck("room:start")).ok).toBe(true);
    const v = await a.until((x) => x.phase === "reveal" && !!x.reveal?.done.some((e) => e.playerId === m.me));
    expect(v.participants).not.toContain(noMic.me);
    const e = v.reveal!.done.find((x) => x.playerId === m.me)!;
    expect(e.status).toBe("muted");
    expect(e.score).toBeNull();
    [a, noMic, m].forEach((x) => x.disconnect());
  }, 40000);

  it("مباراة لا تُلغى بخروج لاعب، وتنتهي بأمان إذا بقي لاعب واحد", async () => {
    const a = new Bot("ثابت");
    const r = await a.create({ rounds: 6, wheel: false });
    if (!r.ok) throw new Error("create failed");
    const b = new Bot("ثاني");
    const c = new Bot("مغادر", "none");
    await b.join(r.code);
    await c.join(r.code);
    await a.until((v) => v.players.length === 3);
    await a.socket.emitWithAck("room:start");
    await a.until((v) => v.phase === "record");
    await c.socket.emitWithAck("room:leave");
    const v = await a.until((x) => x.phase === "intro" && x.round === 2);
    expect(v.participants.length).toBe(2);
    b.disconnect();
    const fin = await a.until((x) => x.phase === "final", 40000);
    expect(fin.final?.reason).toBe("not_enough_players");
    expect(fin.final?.ranking.some((x) => x.name === "مغادر")).toBe(true);
    a.disconnect();
  }, 60000);
});
