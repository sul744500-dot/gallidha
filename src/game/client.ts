// عميل اللعبة: اتصال Socket.IO واحد، حالة الغرفة من الخادم، الجلسة لإعادة الاتصال، والتسجيلات المستلمة

import { io, type Socket } from "socket.io-client";
import type { ActionResult, Avatar, ClientToServer, IceServer, JoinResult, RoomSettings, RoomView, ServerToClient, ToastEvent } from "../../shared/types";
import { addSample, clockInfo, resetClock } from "../lib/clock";
import { deviceId, sessionPref } from "../lib/prefs";
import { createStore } from "../lib/store";
import { mic } from "../audio/mic";
import { voice } from "../audio/voice";
import { decodeRecording, type DecodedRecording } from "../audio/playback";

export type ConnState = "idle" | "connecting" | "connected" | "reconnecting";

export interface GameSnapshot {
  conn: ConnState;
  view: RoomView | null;
  me: string;
  code: string;
}

interface SavedSession {
  code: string;
  playerId: string;
  token: string;
}

type GameSocket = Socket<ServerToClient, ClientToServer>;

class GameClient {
  readonly store = createStore<GameSnapshot>({ conn: "idle", view: null, me: "", code: "" });
  /** «يتكلم» القادمة من الخادم (احتياط عندما تكون الدردشة مطفأة أو الاتصال المباشر فشل) */
  readonly speaking = createStore<Record<string, boolean>>({});
  /** إشعارات للواجهة */
  readonly toasts = createStore<(ToastEvent & { id: number })[]>([]);
  socket: GameSocket | null = null;
  ice: IceServer[] = [];
  /** تسجيلات المباراة الحالية في الذاكرة فقط (تُحذف بنهاية المباراة) */
  recordings = new Map<string, DecodedRecording>();
  recordingListeners = new Set<(key: string) => void>();
  /** أسماء اللاعبين حتى بعد مغادرتهم (لعرض النتائج) */
  names = new Map<string, { name: string; avatar: Avatar }>();
  private toastId = 0;

  get snap() {
    return this.store.get();
  }

  get view() {
    return this.store.get().view;
  }

  get me() {
    return this.store.get().me;
  }

  toast(ev: ToastEvent) {
    const id = ++this.toastId;
    this.toasts.set((t) => [...t.slice(-3), { ...ev, id }]);
    setTimeout(() => this.toasts.set((t) => t.filter((x) => x.id !== id)), 3800);
  }

  ensureSocket(): GameSocket {
    if (this.socket) return this.socket;
    this.store.set((s) => ({ ...s, conn: "connecting" }));
    const socket: GameSocket = io({ transports: ["websocket", "polling"], reconnectionDelay: 600, reconnectionDelayMax: 4000 });
    this.socket = socket;
    socket.on("connect", () => {
      this.store.set((s) => ({ ...s, conn: "connected" }));
      resetClock();
      void this.syncTime();
      if (this.saved()) void this.resume();
    });
    socket.on("disconnect", () => this.store.set((s) => ({ ...s, conn: "reconnecting" })));
    socket.on("room:state", (view) => {
      for (const p of view.players) this.names.set(p.id, { name: p.name, avatar: p.avatar });
      this.store.set((s) => ({ ...s, view, code: view.code }));
    });
    socket.on("room:kicked", (reason) => {
      this.toast({ key: reason === "kicked" ? "toast.kickedYou" : reason === "replaced" ? "toast.replaced" : "toast.roomClosed" });
      this.clearRoom();
      // خرج من اللعبة: نوقف المايك فعليًا
      mic.stop();
    });
    socket.on("room:speaking", ({ id, speaking }) => this.speaking.set((m) => ({ ...m, [id]: speaking })));
    socket.on("rtc:signal", ({ from, data }) => void voice.handleSignal(from, data));
    socket.on("game:recording", ({ round, playerId, wav }) => {
      try {
        const ab = wav instanceof ArrayBuffer ? wav : (wav as unknown as Uint8Array).slice().buffer;
        const key = `${round}:${playerId}`;
        this.recordings.set(key, decodeRecording(ab as ArrayBuffer));
        for (const fn of this.recordingListeners) fn(key);
      } catch (err) {
        console.warn("bad recording", err);
      }
    });
    socket.on("toast", (t) => this.toast(t));
    setInterval(() => void this.syncTime(), 30_000);
    return socket;
  }

  async syncTime() {
    const s = this.socket;
    if (!s?.connected) return;
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      try {
        const server = await s.timeout(3000).emitWithAck("time:ping", t0);
        addSample(t0, server, Date.now());
      } catch {
        return;
      }
    }
  }

  rtt() {
    return clockInfo().rtt;
  }

  private saved(): SavedSession | null {
    return sessionPref.get<SavedSession>("room");
  }

  savedCode(): string | null {
    return this.saved()?.code ?? null;
  }

  private adopt(r: JoinResult) {
    if (!r.ok) return;
    this.ice = r.ice;
    sessionPref.set("room", { code: r.code, playerId: r.playerId, token: r.token });
    this.store.set((s) => ({ ...s, me: r.playerId, code: r.code }));
    voice.start(r.playerId, r.ice, (to, data) => this.socket?.emit("rtc:signal", { to, data }));
  }

  private async call<T>(fn: (s: GameSocket) => Promise<T>): Promise<T | { ok: false; error: "network" }> {
    const s = this.ensureSocket();
    if (!s.connected) {
      const ok = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 8000);
        s.once("connect", () => {
          clearTimeout(t);
          resolve(true);
        });
      });
      if (!ok) return { ok: false, error: "network" };
    }
    try {
      return await fn(s);
    } catch {
      return { ok: false, error: "network" };
    }
  }

  async create(roomName: string, name: string, avatar: Avatar, settings: Partial<RoomSettings>) {
    const r = await this.call((s) =>
      s.timeout(8000).emitWithAck("room:create", { roomName, name, avatar, settings, mic: mic.micState(), device: deviceId() }),
    );
    if (r.ok) this.adopt(r as JoinResult);
    return r as JoinResult | { ok: false; error: "network" };
  }

  async join(code: string, name: string, avatar: Avatar) {
    const r = await this.call((s) => s.timeout(8000).emitWithAck("room:join", { code, name, avatar, mic: mic.micState(), device: deviceId() }));
    if (r.ok) this.adopt(r as JoinResult);
    return r as JoinResult | { ok: false; error: "network" };
  }

  async resume() {
    const saved = this.saved();
    if (!saved) return null;
    const r = await this.call((s) => s.timeout(8000).emitWithAck("room:resume", { ...saved, mic: mic.micState() }));
    if (r.ok) this.adopt(r as JoinResult);
    else if ((r as { error: string }).error !== "network") {
      sessionPref.set("room", null);
      this.clearRoom();
    }
    return r;
  }

  /** مغادرة اللعبة: إغلاق الاتصالات الصوتية وإيقاف كل مسارات المايك */
  leave() {
    this.socket?.emit("room:leave");
    this.clearRoom();
    mic.stop();
  }

  private clearRoom() {
    sessionPref.set("room", null);
    voice.stop();
    this.recordings.clear();
    this.store.set((s) => ({ ...s, view: null, me: "", code: "" }));
  }

  emit<E extends keyof ClientToServer>(event: E, ...args: Parameters<ClientToServer[E]>) {
    (this.socket?.emit as (e: string, ...a: unknown[]) => void)?.(event, ...args);
  }

  async action(event: "room:start" | "room:settings", payload?: Partial<RoomSettings>): Promise<ActionResult> {
    const r = await this.call((s) =>
      event === "room:start" ? s.timeout(5000).emitWithAck("room:start") : s.timeout(5000).emitWithAck("room:settings", payload ?? {}),
    );
    return r as ActionResult;
  }

  async upload(round: number, wav: ArrayBuffer | null, mutedAll: boolean): Promise<ActionResult> {
    const r = await this.call((s) => s.timeout(15000).emitWithAck("game:upload", { round, wav: wav ?? new ArrayBuffer(0), mutedAll }));
    return r as ActionResult;
  }

  async report(playerId: string, reason: string): Promise<ActionResult> {
    const r = await this.call((s) => s.timeout(5000).emitWithAck("player:report", { playerId, reason }));
    return r as ActionResult;
  }

  nameOf(id: string): string {
    return this.view?.players.find((p) => p.id === id)?.name ?? this.names.get(id)?.name ?? "؟";
  }

  avatarOf(id: string): Avatar {
    return this.view?.players.find((p) => p.id === id)?.avatar ?? this.names.get(id)?.avatar ?? { color: 0, hat: 0, eyes: 0 };
  }
}

export const game = new GameClient();
