// منطق الغرفة والمباراة بالكامل على الخادم (المصدر الوحيد للحقيقة):
// العضوية والمضيف وإعادة الاتصال، مراحل الجولة بتوقيت الخادم، استقبال التسجيلات وتقييمها،
// العرض المتسلسل، التصويت، عجلة الحظ والتخريب، والنتائج النهائية.

import { randomBytes } from "node:crypto";
import { MIN_PLAYERS, NAME_MAX, TIMING, VOTE_POINTS, type TimingKey } from "../shared/constants";
import { SABOTAGES, sabotageDurationMs } from "../shared/audio/effects";
import { cleanName, recordWindowMs, sanitizeSettings, STEAL_AMOUNT, wheelNeedsTarget, WHEEL_SLICES } from "../shared/game";
import type {
  ActionResult,
  Avatar,
  FinalAward,
  FinalView,
  MicState,
  Phase,
  PlayerView,
  RoomSettings,
  RoomView,
  RoundEntry,
  SabotageId,
  ScoreResult,
  ToastEvent,
  WheelOutcome,
  WheelView,
} from "../shared/types";
import type { SoundDef, SoundLibrary } from "./packs";
import type { Scorer } from "./scoring/pool";

export interface RoomDeps {
  now(): number;
  random(): number;
  /** معامل تسريع المراحل (1 = طبيعي، أقل للاختبارات) */
  speed: number;
  /** معامل تسريع المدد المرتبطة بطول الأصوات الحقيقية (افتراضيًا = speed) */
  audioSpeed?: number;
  sounds: SoundLibrary;
  scorer: Scorer;
  onChange(room: Room): void;
  sendRecording(room: Room, round: number, playerId: string, wav: Uint8Array): void;
  toast(room: Room, ev: ToastEvent): void;
  kicked(room: Room, playerId: string): void;
}

export interface PlayerState {
  id: string;
  token: string;
  device: string;
  name: string;
  avatar: Avatar;
  joinedAt: number;
  connected: boolean;
  socketId: string | null;
  disconnectedAt: number | null;
  ready: boolean;
  mic: MicState;
  hostMuted: boolean;
  score: number;
  shield: boolean;
  doubleNext: boolean;
  marked: SabotageId | null;
  uploaded: boolean;
}

interface Upload {
  wav: Uint8Array | null;
  mutedAll: boolean;
  result: Promise<ScoreResult>;
  settled: ScoreResult | null;
  durationMs: number;
}

interface PlayerStats {
  name: string;
  avatar: Avatar;
  bestScore: number;
  bestRound: number;
  bestSound: string;
  bestGain: number;
  bestGainRound: number;
  sabotaged: number;
  bestVotes: number;
  bestVotesRound: number;
}

interface WheelState extends WheelView {}

interface Match {
  round: number;
  total: number;
  used: Set<string>;
  sound: SoundDef | null;
  participants: string[];
  loaded: Set<string>;
  recLoaded: Set<string>;
  listenAt: number | null;
  record: { startAt: number; endAt: number; maxMs: number } | null;
  uploads: Map<string, Upload>;
  entries: Map<string, RoundEntry>;
  collecting: boolean;
  scoring: boolean;
  reveal: { order: string[]; index: number; step: "intro" | "play" | "score"; playAt: number | null; done: RoundEntry[] } | null;
  votes: Map<string, string>;
  tally: Record<string, number> | null;
  leaderboard: RoundEntry[] | null;
  wheel: WheelState | null;
  spun: Set<string>;
  roundGain: Map<string, number>;
  stats: Map<string, PlayerStats>;
  departed: { id: string; name: string; avatar: Avatar; score: number }[];
  final: FinalView | null;
}

const newId = (bytes: number) => randomBytes(bytes).toString("base64url");

export class Room {
  readonly createdAt: number;
  settings: RoomSettings;
  players = new Map<string, PlayerState>();
  hostId = "";
  banned = new Set<string>();
  phase: Phase = "lobby";
  phaseAt: number;
  phaseEndsAt: number | null = null;
  rev = 0;
  match: Match | null = null;
  emptySince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    readonly code: string,
    public name: string,
    settings: RoomSettings,
    private deps: RoomDeps,
  ) {
    this.settings = settings;
    this.createdAt = deps.now();
    this.phaseAt = this.createdAt;
  }

  // ───────────── أدوات ─────────────

  private T(key: TimingKey): number {
    return Math.max(1, Math.round(TIMING[key] * this.deps.speed));
  }

  private ms(real: number): number {
    return Math.max(1, Math.round(real * (this.deps.audioSpeed ?? this.deps.speed)));
  }

  private changed() {
    this.rev++;
    if (!this.disposed) this.deps.onChange(this);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number, fn: () => void) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.disposed) fn();
    }, ms);
  }

  private go(phase: Phase, durationMs: number | null) {
    this.phase = phase;
    this.phaseAt = this.deps.now();
    this.phaseEndsAt = durationMs === null ? null : this.phaseAt + durationMs;
    this.changed();
  }

  get isPlaying() {
    return this.phase !== "lobby" && this.phase !== "final";
  }

  get connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  private eligible(): PlayerState[] {
    return [...this.players.values()].filter((p) => p.connected && (p.mic === "on" || p.mic === "muted"));
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
    if (this.hostTimer) clearTimeout(this.hostTimer);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    if (this.match) this.match.uploads.clear();
  }

  // ───────────── العضوية ─────────────

  private uniqueName(raw: string, exceptId?: string): string {
    const taken = new Set([...this.players.values()].filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
    if (!taken.has(raw.toLowerCase())) return raw;
    for (let i = 2; i < 100; i++) {
      const candidate = `${[...raw].slice(0, NAME_MAX - 3).join("")} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return raw;
  }

  addPlayer(rawName: string, avatar: Avatar, mic: MicState, device = ""): PlayerState | null {
    const name = cleanName(rawName, NAME_MAX);
    if (!name) return null;
    const p: PlayerState = {
      id: newId(6),
      token: newId(24),
      device,
      name: this.uniqueName(name),
      avatar,
      joinedAt: this.deps.now(),
      connected: true,
      socketId: null,
      disconnectedAt: null,
      ready: false,
      mic,
      hostMuted: false,
      score: 0,
      shield: false,
      doubleNext: false,
      marked: null,
      uploaded: false,
    };
    this.players.set(p.id, p);
    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = p.id;
    this.emptySince = null;
    this.changed();
    return p;
  }

  /** عودة لاعب انقطع اتصاله برمزه السري */
  resume(playerId: string, token: string): PlayerState | null {
    const p = this.players.get(playerId);
    if (!p || p.token !== token) return null;
    return p;
  }

  attach(p: PlayerState, socketId: string, mic: MicState) {
    p.connected = true;
    p.socketId = socketId;
    p.disconnectedAt = null;
    p.mic = mic;
    this.emptySince = null;
    const t = this.graceTimers.get(p.id);
    if (t) clearTimeout(t);
    this.graceTimers.delete(p.id);
    if (this.hostId === p.id && this.hostTimer) {
      clearTimeout(this.hostTimer);
      this.hostTimer = null;
    }
    this.changed();
  }

  disconnect(playerId: string, socketId: string) {
    const p = this.players.get(playerId);
    if (!p || p.socketId !== socketId) return;
    p.connected = false;
    p.socketId = null;
    p.disconnectedAt = this.deps.now();
    p.ready = false;
    if (this.connectedCount === 0) this.emptySince = this.deps.now();
    // مهلة للعودة قبل الحذف
    this.graceTimers.set(
      p.id,
      setTimeout(() => {
        this.graceTimers.delete(p.id);
        const cur = this.players.get(p.id);
        if (cur && !cur.connected) this.remove(p.id);
      }, this.T("playerGrace")),
    );
    if (this.hostId === p.id) {
      if (this.hostTimer) clearTimeout(this.hostTimer);
      this.hostTimer = setTimeout(() => {
        this.hostTimer = null;
        const host = this.players.get(this.hostId);
        if (host && !host.connected) this.transferHost();
      }, this.T("hostGrace"));
    }
    this.changed();
    this.checkCollectDone();
    this.checkVoteDone();
  }

  private transferHost() {
    const next = [...this.players.values()].filter((p) => p.connected && p.id !== this.hostId).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next) return;
    this.hostId = next.id;
    this.deps.toast(this, { key: "toast.newHost", vars: { name: next.name } });
    this.changed();
  }

  /** حذف لاعب (مغادرة أو انتهاء المهلة أو طرد) */
  remove(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (this.match && this.isPlaying) {
      this.match.departed.push({ id: p.id, name: p.name, avatar: p.avatar, score: p.score });
    }
    this.players.delete(playerId);
    const t = this.graceTimers.get(playerId);
    if (t) clearTimeout(t);
    this.graceTimers.delete(playerId);
    if (this.hostId === playerId) {
      this.hostId = "";
      const next = [...this.players.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinedAt - b.joinedAt)[0];
      if (next) {
        this.hostId = next.id;
        this.deps.toast(this, { key: "toast.newHost", vars: { name: next.name } });
      }
    }
    if (this.connectedCount === 0 && this.emptySince === null) this.emptySince = this.deps.now();
    this.changed();
    this.checkCollectDone();
    this.checkVoteDone();
    if (this.phase === "wheel" && this.match?.wheel?.stage === "pick" && this.match.wheel.spinnerId === playerId) this.autoPick();
  }

  leave(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.deps.toast(this, { key: "toast.left", vars: { name: p.name } });
    this.remove(playerId);
  }

  kick(byId: string, targetId: string): ActionResult {
    if (byId !== this.hostId) return { ok: false, error: "not_host" };
    if (byId === targetId) return { ok: false, error: "bad_request" };
    const p = this.players.get(targetId);
    if (!p) return { ok: false, error: "not_found" };
    this.banned.add(p.token);
    if (p.device) this.banned.add(p.device);
    this.deps.kicked(this, p.id);
    this.deps.toast(this, { key: "toast.kicked", vars: { name: p.name } });
    this.remove(p.id);
    // المطرود لا يظهر في ترتيب النهاية
    if (this.match) this.match.departed = this.match.departed.filter((d) => d.id !== p.id);
    return { ok: true };
  }

  setReady(id: string, ready: boolean) {
    const p = this.players.get(id);
    if (!p || this.phase !== "lobby") return;
    p.ready = ready;
    this.changed();
  }

  setMic(id: string, mic: MicState) {
    const p = this.players.get(id);
    if (!p || p.mic === mic) return;
    p.mic = mic;
    this.changed();
  }

  setProfile(id: string, patch: { name?: unknown; avatar?: Avatar }) {
    const p = this.players.get(id);
    if (!p) return;
    if (patch.name !== undefined) {
      const n = cleanName(patch.name, NAME_MAX);
      if (n) p.name = this.uniqueName(n, id);
    }
    if (patch.avatar) p.avatar = patch.avatar;
    this.changed();
  }

  hostMute(byId: string, targetId: string, muted: boolean) {
    if (byId !== this.hostId || byId === targetId) return;
    const p = this.players.get(targetId);
    if (!p) return;
    p.hostMuted = muted;
    this.changed();
  }

  updateSettings(byId: string, patch: unknown): ActionResult {
    if (byId !== this.hostId) return { ok: false, error: "not_host" };
    if (this.isPlaying) return { ok: false, error: "in_game" };
    this.settings = sanitizeSettings(patch, this.settings);
    this.changed();
    return { ok: true };
  }

  // ───────────── المباراة ─────────────

  start(byId: string): ActionResult {
    if (byId !== this.hostId) return { ok: false, error: "not_host" };
    if (this.isPlaying) return { ok: false, error: "in_game" };
    if (this.eligible().length < MIN_PLAYERS) return { ok: false, error: "not_enough" };
    for (const p of this.players.values()) {
      p.score = 0;
      p.shield = false;
      p.doubleNext = false;
      p.marked = null;
      p.uploaded = false;
      p.ready = false;
    }
    this.match = {
      round: 0,
      total: this.settings.rounds,
      used: new Set(),
      sound: null,
      participants: [],
      loaded: new Set(),
      recLoaded: new Set(),
      listenAt: null,
      record: null,
      uploads: new Map(),
      entries: new Map(),
      collecting: false,
      scoring: false,
      reveal: null,
      votes: new Map(),
      tally: null,
      leaderboard: null,
      wheel: null,
      spun: new Set(),
      roundGain: new Map(),
      stats: new Map(),
      departed: [],
      final: null,
    };
    this.nextRound();
    return { ok: true };
  }

  backToLobby(byId: string) {
    if (byId !== this.hostId || this.phase !== "final") return;
    this.match = null;
    for (const p of this.players.values()) {
      p.ready = false;
      p.score = 0;
      p.shield = false;
      p.doubleNext = false;
      p.marked = null;
    }
    this.clearTimer();
    this.go("lobby", null);
  }

  private stat(p: PlayerState): PlayerStats {
    const m = this.match!;
    let s = m.stats.get(p.id);
    if (!s) {
      s = { name: p.name, avatar: p.avatar, bestScore: -1, bestRound: 0, bestSound: "", bestGain: 0, bestGainRound: 0, sabotaged: 0, bestVotes: 0, bestVotesRound: 0 };
      m.stats.set(p.id, s);
    }
    s.name = p.name;
    s.avatar = p.avatar;
    return s;
  }

  private gain(p: PlayerState, pts: number) {
    const m = this.match!;
    m.roundGain.set(p.id, (m.roundGain.get(p.id) ?? 0) + pts);
  }

  private nextRound() {
    const m = this.match!;
    if (m.round >= m.total) return this.finish("completed");
    const eligible = this.eligible().sort((a, b) => a.joinedAt - b.joinedAt);
    if (eligible.length < MIN_PLAYERS) return this.finish("not_enough_players");
    m.round++;
    m.participants = eligible.map((p) => p.id);
    m.sound = this.deps.sounds.pick(this.settings, m.used, this.deps.random);
    m.used.add(m.sound.info.id);
    m.loaded = new Set();
    m.recLoaded = new Set();
    m.listenAt = null;
    m.record = null;
    m.uploads = new Map();
    m.entries = new Map();
    m.collecting = false;
    m.scoring = false;
    m.reveal = null;
    m.votes = new Map();
    m.tally = null;
    m.leaderboard = null;
    m.wheel = null;
    m.roundGain = new Map();
    for (const p of this.players.values()) p.uploaded = false;
    this.go("intro", this.T("introMin"));
    this.schedule(this.T("introMin"), () => this.afterIntro());
  }

  /** ننتظر تحميل الصوت المرجعي عند الجميع (بحد أقصى) حتى يسمعوه بنفس اللحظة */
  private afterIntro() {
    const m = this.match!;
    const waiting = m.participants.filter((id) => this.players.get(id)?.connected && !m.loaded.has(id));
    if (waiting.length && this.deps.now() - this.phaseAt < this.T("introMax")) {
      this.schedule(this.ms(200), () => this.afterIntro());
      return;
    }
    const sound = m.sound!;
    m.listenAt = this.deps.now() + this.T("listenLead");
    this.go("listen", this.T("listenLead") + this.ms(sound.info.durationMs) + this.T("listenTail"));
    this.schedule(this.phaseEndsAt! - this.phaseAt, () => this.startCountdown());
  }

  onLoaded(playerId: string, round: number, what: "sound" | "recordings") {
    const m = this.match;
    if (!m || m.round !== round || !m.participants.length) return;
    if (what === "sound") {
      m.loaded.add(playerId);
      if (this.phase === "intro" && this.deps.now() - this.phaseAt >= this.T("introMin")) {
        const waiting = m.participants.filter((id) => this.players.get(id)?.connected && !m.loaded.has(id));
        if (!waiting.length) this.afterIntro();
      }
    } else m.recLoaded.add(playerId);
  }

  private countdownSpec() {
    const hard = this.settings.mode === "hard";
    return { steps: hard ? 2 : 3, stepMs: this.T(hard ? "countdownStepHard" : "countdownStep") };
  }

  private startCountdown() {
    const { steps, stepMs } = this.countdownSpec();
    this.go("countdown", steps * stepMs);
    this.schedule(steps * stepMs, () => this.startRecord());
  }

  private startRecord() {
    const m = this.match!;
    const realWindow = recordWindowMs(this.settings, m.sound!.info.durationMs);
    const startAt = this.deps.now() + this.T("recordLead");
    const endAt = startAt + this.ms(realWindow);
    m.record = { startAt, endAt, maxMs: realWindow + 1500 };
    this.go("record", this.T("recordLead") + this.ms(realWindow) + this.T("recordTail"));
    this.schedule(this.phaseEndsAt! - this.phaseAt, () => this.startCollect());
  }

  private startCollect() {
    const m = this.match!;
    m.collecting = true;
    this.go("collect", this.T("collectMax"));
    this.schedule(this.T("collectMax"), () => void this.finishCollect());
    this.checkCollectDone();
  }

  /** استلام تسجيل لاعب: نتحقق منه ثم نبدأ تقييمه فورًا في عامل منفصل */
  onUpload(playerId: string, round: number, wav: Uint8Array | null, mutedAll: boolean): ActionResult {
    const m = this.match;
    if (!m || m.round !== round) return { ok: false, error: "bad_round" };
    if (this.phase !== "record" && this.phase !== "collect") return { ok: false, error: "bad_phase" };
    if (!m.participants.includes(playerId)) return { ok: false, error: "not_participant" };
    if (m.uploads.has(playerId)) return { ok: false, error: "duplicate" };
    if (!m.record || this.deps.now() < m.record.startAt) return { ok: false, error: "too_early" };
    const p = this.players.get(playerId)!;
    const sound = m.sound!;
    let upload: Upload;
    if (mutedAll || !wav) {
      const res: ScoreResult = { status: mutedAll ? "muted" : "missing", score: null, parts: null };
      upload = { wav: null, mutedAll, result: Promise.resolve(res), settled: res, durationMs: 0 };
    } else {
      const durationMs = Math.max(0, Math.round(((wav.byteLength - 44) / 2 / 16000) * 1000));
      const result = this.deps.scorer.score({ soundId: sound.info.id, file: sound.file, weights: sound.weights, wav, maxMs: m.record.maxMs });
      upload = { wav, mutedAll: false, result, settled: null, durationMs };
      void result.then((r) => (upload.settled = r));
    }
    m.uploads.set(playerId, upload);
    p.uploaded = true;
    this.changed();
    this.checkCollectDone();
    return { ok: true };
  }

  private checkCollectDone() {
    const m = this.match;
    if (!m || this.phase !== "collect" || !m.collecting) return;
    const waiting = m.participants.filter((id) => this.players.get(id)?.connected && !m.uploads.has(id));
    if (!waiting.length) void this.finishCollect();
  }

  private async finishCollect() {
    const m = this.match;
    if (!m || this.phase !== "collect" || !m.collecting) return;
    m.collecting = false;
    m.scoring = true;
    this.clearTimer();
    this.changed();
    const round = m.round;
    // نرسل التسجيلات للجميع الآن ليجهزوها أثناء انتهاء التقييم
    for (const [id, up] of m.uploads) if (up.wav) this.deps.sendRecording(this, round, id, up.wav);
    const ids = [...m.participants];
    const results = await Promise.all(ids.map((id) => m.uploads.get(id)?.result ?? Promise.resolve<ScoreResult>({ status: "missing", score: null, parts: null })));
    if (this.disposed || this.match !== m || m.round !== round || this.phase !== "collect") return;
    ids.forEach((id, i) => {
      const up = m.uploads.get(id);
      const res = results[i];
      m.entries.set(id, {
        playerId: id,
        status: res.status,
        score: res.status === "ok" ? res.score : null,
        parts: res.status === "ok" ? res.parts : null,
        multiplier: 1,
        points: 0,
        votes: 0,
        voteBonus: 0,
        sabotage: null,
        durationMs: up?.durationMs ?? 0,
        playMs: up?.wav ? up.durationMs : 0,
      });
    });
    m.scoring = false;
    // ننتظر وصول التسجيلات للأجهزة (بحد أقصى) حتى يبدأ العرض متزامنًا
    const waitStart = this.deps.now();
    const waitLoaded = () => {
      if (this.disposed || this.match !== m || m.round !== round) return;
      const hasAudio = [...m.uploads.values()].some((u) => u.wav);
      const waiting = hasAudio ? [...this.players.values()].filter((p) => p.connected && !m.recLoaded.has(p.id)) : [];
      if (waiting.length && this.deps.now() - waitStart < this.T("loadMax")) {
        this.schedule(this.ms(150), waitLoaded);
        return;
      }
      this.startReveal();
    };
    waitLoaded();
  }

  private startReveal() {
    const m = this.match!;
    const order = [...m.participants];
    if (this.settings.revealOrder === "random") {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(this.deps.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    m.reveal = { order, index: 0, step: "intro", playAt: null, done: [] };
    this.revealIntro();
  }

  private revealIntro() {
    const m = this.match!;
    const r = m.reveal!;
    const id = r.order[r.index];
    const entry = m.entries.get(id)!;
    const p = this.players.get(id);
    // التخريب ينكشف هنا: يُطبّق على التشغيل فقط، والدرجة محسوبة من التسجيل النظيف
    if (p?.marked && entry.playMs > 0) {
      entry.sabotage = p.marked;
      entry.playMs = sabotageDurationMs(p.marked, entry.durationMs);
      p.marked = null;
      this.stat(p).sabotaged++;
    }
    r.step = "intro";
    r.playAt = null;
    this.go("reveal", this.T("revealIntro"));
    this.schedule(this.T("revealIntro"), () => this.revealPlay());
  }

  private revealPlay() {
    const m = this.match!;
    const r = m.reveal!;
    const entry = m.entries.get(r.order[r.index])!;
    if (entry.playMs <= 0) return this.revealScore();
    r.step = "play";
    r.playAt = this.deps.now() + this.T("revealPlayLead");
    this.go("reveal", this.T("revealPlayLead") + this.ms(entry.playMs) + this.T("revealGap"));
    this.schedule(this.phaseEndsAt! - this.phaseAt, () => this.revealScore());
  }

  private revealScore() {
    const m = this.match!;
    const r = m.reveal!;
    const id = r.order[r.index];
    const entry = m.entries.get(id)!;
    const p = this.players.get(id);
    if (p) {
      if (entry.status === "ok" && entry.score !== null) {
        entry.multiplier = p.doubleNext ? 2 : 1;
        p.doubleNext = false;
        entry.points = entry.score * entry.multiplier;
        p.score += entry.points;
        this.gain(p, entry.points);
        const s = this.stat(p);
        if (entry.score > s.bestScore) {
          s.bestScore = entry.score;
          s.bestRound = m.round;
          s.bestSound = m.sound!.info.id;
        }
      } else this.stat(p);
    }
    r.done.push(entry);
    r.step = "score";
    r.playAt = null;
    this.go("reveal", this.T("revealScore"));
    this.schedule(this.T("revealScore"), () => {
      if (r.index + 1 < r.order.length) {
        r.index++;
        this.revealIntro();
      } else if (this.settings.mode === "laugh" && m.participants.length > 2) this.startVote();
      else this.startLeaderboard();
    });
  }

  private startVote() {
    this.go("vote", this.T("vote"));
    this.schedule(this.T("vote"), () => this.closeVote());
  }

  vote(voterId: string, targetId: string) {
    const m = this.match;
    if (!m || this.phase !== "vote" || voterId === targetId) return;
    if (!m.participants.includes(voterId) || !m.participants.includes(targetId)) return;
    m.votes.set(voterId, targetId);
    this.changed();
    this.checkVoteDone();
  }

  private checkVoteDone() {
    const m = this.match;
    if (!m || this.phase !== "vote") return;
    const waiting = m.participants.filter((id) => this.players.get(id)?.connected && !m.votes.has(id));
    if (!waiting.length) this.closeVote();
  }

  private closeVote() {
    const m = this.match!;
    if (this.phase !== "vote") return;
    const tally: Record<string, number> = {};
    for (const target of m.votes.values()) tally[target] = (tally[target] ?? 0) + 1;
    m.tally = tally;
    for (const [id, votes] of Object.entries(tally)) {
      const entry = m.entries.get(id);
      const p = this.players.get(id);
      if (!entry) continue;
      entry.votes = votes;
      entry.voteBonus = votes * VOTE_POINTS;
      if (p) {
        p.score += entry.voteBonus;
        this.gain(p, entry.voteBonus);
        const s = this.stat(p);
        if (votes > s.bestVotes) {
          s.bestVotes = votes;
          s.bestVotesRound = m.round;
        }
      }
    }
    this.startLeaderboard();
  }

  private startLeaderboard() {
    const m = this.match!;
    m.leaderboard = [...m.entries.values()].sort((a, b) => b.points + b.voteBonus - (a.points + a.voteBonus));
    // سياسة الحذف: تسجيلات الجولة تُحذف من ذاكرة الخادم فور انتهاء عرضها
    m.uploads = new Map();
    this.go("leaderboard", this.T("leaderboard"));
    this.schedule(this.T("leaderboard"), () => {
      this.closeRoundStats();
      if (m.round >= m.total) this.finish("completed");
      else if (this.settings.wheel) this.startWheel();
      else this.nextRound();
    });
  }

  private closeRoundStats() {
    const m = this.match!;
    for (const [id, g] of m.roundGain) {
      const p = this.players.get(id);
      if (!p) continue;
      const s = this.stat(p);
      if (g > s.bestGain) {
        s.bestGain = g;
        s.bestGainRound = m.round;
      }
    }
  }

  // ───────────── عجلة الحظ ─────────────

  /** يدور عليها الأقل نقاطًا ممن لم يدوروا بعد (فرصة للعودة)، ثم تبدأ الدورة من جديد */
  private pickSpinner(): PlayerState | null {
    const m = this.match!;
    const pool = () => [...this.players.values()].filter((p) => p.connected && m.participants.includes(p.id) && !m.spun.has(p.id));
    let cands = pool();
    if (!cands.length) {
      m.spun.clear();
      cands = pool();
    }
    if (!cands.length) return null;
    const min = Math.min(...cands.map((p) => p.score));
    const lowest = cands.filter((p) => p.score === min);
    const chosen = lowest[Math.floor(this.deps.random() * lowest.length) % lowest.length];
    m.spun.add(chosen.id);
    return chosen;
  }

  private startWheel() {
    const m = this.match!;
    const spinner = this.pickSpinner();
    if (!spinner) return this.nextRound();
    m.wheel = {
      spinnerId: spinner.id,
      slices: WHEEL_SLICES,
      stage: "intro",
      spinAt: null,
      spinMs: this.T("wheelSpin"),
      sliceIndex: null,
      sliceOffset: 0.5,
      outcome: null,
      pickEndsAt: null,
      targetId: null,
      blocked: false,
      amount: 0,
    };
    this.go("wheel", this.T("wheelIntro"));
    this.schedule(this.T("wheelIntro"), () => this.spin());
  }

  private spin() {
    const w = this.match!.wheel!;
    w.sliceIndex = Math.floor(this.deps.random() * w.slices.length) % w.slices.length;
    w.sliceOffset = 0.15 + this.deps.random() * 0.7;
    w.stage = "spin";
    w.spinAt = this.deps.now() + this.T("wheelSpinLead");
    this.go("wheel", this.T("wheelSpinLead") + w.spinMs);
    this.schedule(this.T("wheelSpinLead") + w.spinMs, () => this.afterSpin());
  }

  private targets(): PlayerState[] {
    const w = this.match!.wheel!;
    return [...this.players.values()].filter((p) => p.id !== w.spinnerId);
  }

  private afterSpin() {
    const w = this.match!.wheel!;
    let outcome: WheelOutcome = w.slices[w.sliceIndex!];
    if (wheelNeedsTarget(outcome) && !this.targets().length) outcome = "plus20";
    w.outcome = outcome;
    if (!wheelNeedsTarget(outcome)) return this.applyOutcome(null);
    const spinner = this.players.get(w.spinnerId);
    if (!spinner?.connected) return this.autoPick();
    w.stage = "pick";
    w.pickEndsAt = this.deps.now() + this.T("wheelPick");
    this.go("wheel", this.T("wheelPick"));
    this.schedule(this.T("wheelPick"), () => this.autoPick());
  }

  wheelPick(byId: string, targetId: string) {
    const w = this.match?.wheel;
    if (!w || this.phase !== "wheel" || w.stage !== "pick" || byId !== w.spinnerId) return;
    if (!this.targets().some((p) => p.id === targetId)) return;
    this.applyOutcome(targetId);
  }

  private autoPick() {
    const w = this.match?.wheel;
    if (!w || this.phase !== "wheel" || w.stage === "result") return;
    const t = this.targets();
    if (!t.length) {
      w.outcome = "plus20";
      return this.applyOutcome(null);
    }
    this.applyOutcome(t[Math.floor(this.deps.random() * t.length) % t.length].id);
  }

  private applyOutcome(targetId: string | null) {
    const m = this.match!;
    const w = m.wheel!;
    const spinner = this.players.get(w.spinnerId);
    const target = targetId ? this.players.get(targetId) : undefined;
    w.targetId = targetId;
    w.blocked = false;
    w.amount = 0;
    if (spinner) {
      switch (w.outcome) {
        case "plus20":
        case "plus50":
          w.amount = w.outcome === "plus20" ? 20 : 50;
          spinner.score += w.amount;
          this.gain(spinner, w.amount);
          break;
        case "double":
          spinner.doubleNext = true;
          break;
        case "shield":
          spinner.shield = true;
          break;
        case "steal":
        case "swap":
        case "sabotage":
          if (!target) break;
          // الدرع يصد أي هجوم مرة واحدة
          if (target.shield) {
            target.shield = false;
            w.blocked = true;
            break;
          }
          if (w.outcome === "steal") {
            w.amount = Math.min(STEAL_AMOUNT, target.score);
            target.score -= w.amount;
            spinner.score += w.amount;
            this.gain(spinner, w.amount);
          } else if (w.outcome === "swap") {
            const a = spinner.score;
            spinner.score = target.score;
            target.score = a;
            w.amount = spinner.score - a;
            if (w.amount > 0) this.gain(spinner, w.amount);
          } else {
            target.marked = SABOTAGES[Math.floor(this.deps.random() * SABOTAGES.length) % SABOTAGES.length];
          }
          break;
      }
    }
    w.stage = "result";
    w.pickEndsAt = null;
    this.go("wheel", this.T("wheelResult"));
    this.schedule(this.T("wheelResult"), () => {
      this.closeRoundStats();
      this.nextRound();
    });
  }

  // ───────────── النهاية ─────────────

  private finish(reason: FinalView["reason"]) {
    const m = this.match!;
    this.clearTimer();
    m.uploads = new Map();
    const ranking = [
      ...[...this.players.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score })),
      ...m.departed.filter((d) => !this.players.has(d.id)),
    ].sort((a, b) => b.score - a.score);
    const stats = [...m.stats.entries()];
    const top = (pick: (s: PlayerStats) => number, min: number, extra: (s: PlayerStats) => Partial<FinalAward>): FinalAward | null => {
      let best: FinalAward | null = null;
      for (const [id, s] of stats) {
        const v = pick(s);
        if (v >= min && (!best || v > best.value)) best = { playerId: id, value: v, ...extra(s) };
      }
      return best;
    };
    m.final = {
      reason,
      ranking,
      best: top((s) => s.bestScore, 0, (s) => ({ round: s.bestRound, soundId: s.bestSound })),
      mostGained: top((s) => s.bestGain, 1, (s) => ({ round: s.bestGainRound })),
      mostSabotaged: top((s) => s.sabotaged, 1, () => ({})),
      funniest: top((s) => s.bestVotes, 1, (s) => ({ round: s.bestVotesRound })),
    };
    for (const p of this.players.values()) p.ready = false;
    this.go("final", null);
  }

  // ───────────── العرض ─────────────

  voiceOpen(): boolean {
    if (!this.settings.voiceChat) return false;
    switch (this.phase) {
      case "listen":
      case "countdown":
      case "record":
        return false;
      case "reveal":
        return this.match?.reveal?.step === "score";
      default:
        return true;
    }
  }

  view(): RoomView {
    const m = this.match;
    const players: PlayerView[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      connected: p.connected,
      ready: p.ready,
      mic: p.mic,
      hostMuted: p.hostMuted,
      score: p.score,
      shield: p.shield,
      doubleNext: p.doubleNext,
      marked: !!p.marked,
      uploaded: p.uploaded,
      joinedAt: p.joinedAt,
    }));
    const inMatch = !!m && this.phase !== "lobby";
    const r = m?.reveal;
    let reveal: RoomView["reveal"] = null;
    if (m && r && this.phase === "reveal") {
      const id = r.order[r.index];
      const entry = m.entries.get(id)!;
      reveal = {
        order: r.order,
        index: r.index,
        step: r.step,
        current: {
          playerId: id,
          sabotage: r.step === "intro" ? null : entry.sabotage,
          hasAudio: entry.playMs > 0,
          playAt: r.playAt,
          playMs: entry.playMs,
          result: r.step === "score" ? { ...entry } : null,
        },
        done: r.done.map((e) => ({ ...e })),
      };
    }
    return {
      code: this.code,
      name: this.name,
      hostId: this.hostId,
      settings: this.settings,
      players,
      phase: this.phase,
      phaseAt: this.phaseAt,
      phaseEndsAt: this.phaseEndsAt,
      now: this.deps.now(),
      voiceOpen: this.voiceOpen(),
      round: inMatch ? m!.round : 0,
      totalRounds: m?.total ?? this.settings.rounds,
      participants: inMatch ? m!.participants : [],
      sound: inMatch && m!.sound && this.phase !== "final" ? m!.sound.info : null,
      listenAt: inMatch ? m!.listenAt : null,
      countdown: this.phase === "countdown" ? this.countdownSpec() : null,
      record: inMatch && m!.record && (this.phase === "record" || this.phase === "collect") ? { startAt: m!.record.startAt, endAt: m!.record.endAt } : null,
      collect: this.phase === "collect" ? { scoring: m!.scoring, audio: m!.collecting ? null : [...m!.uploads.entries()].filter(([, u]) => u.wav).map(([id]) => id) } : null,
      reveal,
      vote: this.phase === "vote" || (this.phase === "leaderboard" && m?.tally) ? { voters: [...(m?.votes.keys() ?? [])], tally: m?.tally ?? null } : null,
      leaderboard: this.phase === "leaderboard" ? (m?.leaderboard ?? null) : null,
      wheel: this.phase === "wheel" && m?.wheel ? { ...m.wheel } : null,
      final: this.phase === "final" ? (m?.final ?? null) : null,
      rev: this.rev,
    };
  }
}
