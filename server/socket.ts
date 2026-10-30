// ربط Socket.IO بمنطق الغرف: تحقق من كل حدث، حدود للمعدل، وتمرير إشارات WebRTC بين أعضاء نفس الغرفة فقط

import type { Server, Socket } from "socket.io";
import { AVATAR_COLORS, EYES, HATS, MAX_RECORDING_BYTES, NAME_MAX, REPORT_MAX } from "../shared/constants";
import { cleanName, isValidCode } from "../shared/game";
import type { Avatar, ClientToServer, JoinResult, MicState, RtcData, ServerToClient } from "../shared/types";
import { iceServers } from "./ice";
import type { SoundLibrary } from "./packs";
import type { ReportStore } from "./reports";
import type { Room } from "./room";
import { RoomManager } from "./roomManager";
import type { Scorer } from "./scoring/pool";

export type GameServer = Server<ClientToServer, ServerToClient>;
type GameSocket = Socket<ClientToServer, ServerToClient>;

export interface GameOptions {
  sounds: SoundLibrary;
  scorer: Scorer;
  reports: ReportStore;
  now?: () => number;
  random?: () => number;
  speed?: number;
  audioSpeed?: number;
  /** حدود المعدل لكل اتصال */
  perSecond?: number;
  burst?: number;
  trustProxy?: boolean;
}

class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private rate: number,
    private cap: number,
  ) {
    this.tokens = cap;
  }
  take(n = 1): boolean {
    const t = Date.now();
    this.tokens = Math.min(this.cap, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

const MIC_STATES: MicState[] = ["on", "muted", "off", "denied"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const intIn = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < max ? v : 0);

export function parseAvatar(v: unknown): Avatar {
  const o = isObj(v) ? v : {};
  return { color: intIn(o.color, AVATAR_COLORS.length), hat: intIn(o.hat, HATS.length), eyes: intIn(o.eyes, EYES.length) };
}
const parseMic = (v: unknown): MicState => (MIC_STATES.includes(v as MicState) ? (v as MicState) : "off");
const parseDevice = (v: unknown) => (typeof v === "string" && /^[\w-]{8,64}$/.test(v) ? v : "");

function validSignal(d: unknown): d is RtcData {
  if (!isObj(d)) return false;
  if (JSON.stringify(d).length > 20_000) return false;
  if (d.type === "description") {
    const sdp = d.sdp;
    return isObj(sdp) && ["offer", "answer", "pranswer", "rollback"].includes(sdp.type as string) && (sdp.sdp === undefined || typeof sdp.sdp === "string");
  }
  if (d.type === "candidate") return d.candidate === null || (isObj(d.candidate) && typeof d.candidate.candidate === "string");
  return false;
}

export function attachGame(io: GameServer, opts: GameOptions) {
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, { room: Room; playerId: string }>();
  const joinFails = new Map<string, { n: number; reset: number }>();
  const pending = new Set<Room>();
  let flushQueued = false;

  const flush = () => {
    flushQueued = false;
    for (const room of pending) if (manager.get(room.code) === room) io.to(room.code).emit("room:state", room.view());
    pending.clear();
  };

  const socketOf = (id: string | null) => (id ? io.sockets.sockets.get(id) : undefined);

  const manager = new RoomManager(
    { now, random: opts.random ?? Math.random, speed: opts.speed ?? 1, audioSpeed: opts.audioSpeed, sounds: opts.sounds, scorer: opts.scorer },
    {
      onChange(room) {
        pending.add(room);
        if (!flushQueued) {
          flushQueued = true;
          setImmediate(flush);
        }
      },
      sendRecording(room, round, playerId, wav) {
        io.to(room.code).emit("game:recording", { round, playerId, wav: Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength) as unknown as ArrayBuffer });
      },
      toast(room, ev) {
        io.to(room.code).emit("toast", ev);
      },
      kicked(room, playerId) {
        const s = socketOf(room.players.get(playerId)?.socketId ?? null);
        if (!s) return;
        s.emit("room:kicked", "kicked");
        void s.leave(room.code);
        sessions.delete(s.id);
      },
      closed(room) {
        io.to(room.code).emit("room:kicked", "closed");
        io.in(room.code).socketsLeave(room.code);
        for (const [sid, sess] of sessions) if (sess.room === room) sessions.delete(sid);
      },
    },
  );

  const ipOf = (socket: GameSocket) => {
    if (opts.trustProxy) {
      const fwd = socket.handshake.headers["x-forwarded-for"];
      if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
    }
    return socket.handshake.address;
  };

  const tooManyFails = (ip: string) => {
    const f = joinFails.get(ip);
    return !!f && f.reset > Date.now() && f.n >= 25;
  };
  const noteFail = (ip: string) => {
    const f = joinFails.get(ip);
    if (!f || f.reset < Date.now()) joinFails.set(ip, { n: 1, reset: Date.now() + 5 * 60_000 });
    else f.n++;
    if (joinFails.size > 5000) joinFails.clear();
  };

  io.on("connection", (socket: GameSocket) => {
    const general = new Bucket(opts.perSecond ?? 15, opts.burst ?? 40);
    const signals = new Bucket(80, 300);
    const speaking = new Bucket(8, 16);
    const reports = new Bucket(0.02, 3);
    const ip = ipOf(socket);

    const session = () => sessions.get(socket.id);

    const bind = (room: Room, playerId: string, mic: MicState): JoinResult => {
      const p = room.players.get(playerId)!;
      // نفس اللاعب فتح من تبويب آخر: ننقل الجلسة للاتصال الجديد
      if (p.socketId && p.socketId !== socket.id) {
        const old = socketOf(p.socketId);
        if (old) {
          old.emit("room:kicked", "replaced");
          void old.leave(room.code);
          sessions.delete(old.id);
        }
      }
      void socket.join(room.code);
      sessions.set(socket.id, { room, playerId });
      room.attach(p, socket.id, mic);
      return { ok: true, code: room.code, playerId: p.id, token: p.token, ice: iceServers(p.id) };
    };

    const leaveCurrent = () => {
      const s = session();
      if (!s) return;
      sessions.delete(socket.id);
      void socket.leave(s.room.code);
      s.room.leave(s.playerId);
    };

    const guard =
      <A extends unknown[]>(fn: (...args: A) => void, bucket = general) =>
      (...args: A) => {
        if (!bucket.take()) {
          const ack = args[args.length - 1];
          if (typeof ack === "function") (ack as (r: unknown) => void)({ ok: false, error: "rate_limited" });
          return;
        }
        try {
          fn(...args);
        } catch (err) {
          console.error("! خطأ في حدث:", err);
        }
      };

    socket.on(
      "time:ping",
      guard((_t0, ack) => {
        if (typeof ack === "function") ack(now());
      }, new Bucket(5, 20)),
    );

    socket.on(
      "room:create",
      guard((p, ack) => {
        if (typeof ack !== "function") return;
        const name = cleanName(isObj(p) ? p.name : null, NAME_MAX);
        if (!name) return ack({ ok: false, error: "bad_name" });
        leaveCurrent();
        const room = manager.create(isObj(p) ? p.roomName : null, isObj(p) && isObj(p.settings) ? p.settings : undefined);
        const player = room.addPlayer(name, parseAvatar(p.avatar), parseMic(p.mic), parseDevice(p.device))!;
        ack(bind(room, player.id, parseMic(p.mic)));
      }),
    );

    socket.on(
      "room:join",
      guard((p, ack) => {
        if (typeof ack !== "function") return;
        if (tooManyFails(ip)) return ack({ ok: false, error: "rate_limited" });
        if (!isObj(p) || !isValidCode(p.code)) return ack({ ok: false, error: "bad_request" });
        const room = manager.get(p.code);
        if (!room) {
          noteFail(ip);
          return ack({ ok: false, error: "not_found" });
        }
        const device = parseDevice(p.device);
        if (device && room.banned.has(device)) return ack({ ok: false, error: "kicked" });
        if (room.players.size >= room.settings.maxPlayers) return ack({ ok: false, error: "full" });
        const name = cleanName(p.name, NAME_MAX);
        if (!name) return ack({ ok: false, error: "bad_name" });
        leaveCurrent();
        const player = room.addPlayer(name, parseAvatar(p.avatar), parseMic(p.mic), device)!;
        socket.to(room.code).emit("toast", { key: "toast.joined", vars: { name: player.name } });
        ack(bind(room, player.id, parseMic(p.mic)));
      }),
    );

    socket.on(
      "room:resume",
      guard((p, ack) => {
        if (typeof ack !== "function") return;
        if (!isObj(p) || !isValidCode(p.code) || typeof p.playerId !== "string" || typeof p.token !== "string") return ack({ ok: false, error: "bad_request" });
        const room = manager.get(p.code);
        if (!room) return ack({ ok: false, error: "not_found" });
        if (room.banned.has(p.token)) return ack({ ok: false, error: "kicked" });
        const player = room.resume(p.playerId, p.token);
        if (!player) return ack({ ok: false, error: "expired" });
        const cur = session();
        if (cur && cur.room !== room) leaveCurrent();
        ack(bind(room, player.id, parseMic(p.mic)));
      }),
    );

    socket.on(
      "room:leave",
      guard((ack) => {
        leaveCurrent();
        if (typeof ack === "function") ack({ ok: true });
      }),
    );

    socket.on(
      "room:ready",
      guard((ready) => {
        const s = session();
        if (s) s.room.setReady(s.playerId, ready === true);
      }),
    );

    socket.on(
      "room:settings",
      guard((patch, ack) => {
        const s = session();
        const r = s ? s.room.updateSettings(s.playerId, patch) : { ok: false as const, error: "no_room" };
        if (typeof ack === "function") ack(r);
      }),
    );

    socket.on(
      "room:kick",
      guard((id) => {
        const s = session();
        if (s && typeof id === "string") s.room.kick(s.playerId, id);
      }),
    );

    socket.on(
      "room:host-mute",
      guard((p) => {
        const s = session();
        if (s && isObj(p) && typeof p.playerId === "string") s.room.hostMute(s.playerId, p.playerId, p.muted === true);
      }),
    );

    socket.on(
      "room:start",
      guard((ack) => {
        const s = session();
        const r = s ? s.room.start(s.playerId) : { ok: false as const, error: "no_room" };
        if (typeof ack === "function") ack(r);
      }),
    );

    socket.on(
      "room:lobby",
      guard(() => {
        const s = session();
        if (s) s.room.backToLobby(s.playerId);
      }),
    );

    socket.on(
      "room:profile",
      guard((p) => {
        const s = session();
        if (!s || !isObj(p)) return;
        s.room.setProfile(s.playerId, { name: p.name, avatar: p.avatar ? parseAvatar(p.avatar) : undefined });
      }),
    );

    socket.on(
      "player:mic",
      guard((state) => {
        const s = session();
        if (s && MIC_STATES.includes(state)) s.room.setMic(s.playerId, state);
      }),
    );

    socket.on(
      "player:speaking",
      guard((speakingNow) => {
        const s = session();
        if (!s) return;
        socket.to(s.room.code).emit("room:speaking", { id: s.playerId, speaking: speakingNow === true });
      }, speaking),
    );

    socket.on(
      "player:report",
      guard((p, ack) => {
        const s = session();
        const reply = (r: { ok: true } | { ok: false; error: string }) => typeof ack === "function" && ack(r);
        if (!s || !isObj(p) || typeof p.playerId !== "string") return reply({ ok: false, error: "bad_request" });
        const target = s.room.players.get(p.playerId);
        const me = s.room.players.get(s.playerId);
        if (!target || !me || target.id === me.id) return reply({ ok: false, error: "not_found" });
        const reason = cleanName(p.reason, REPORT_MAX) ?? "-";
        opts.reports
          .add({ at: new Date().toISOString(), room: s.room.code, reporterId: me.id, reporterName: me.name, targetId: target.id, targetName: target.name, reason })
          .then(() => reply({ ok: true }))
          .catch(() => reply({ ok: false, error: "store_failed" }));
      }, reports),
    );

    socket.on(
      "rtc:signal",
      guard((p) => {
        const s = session();
        if (!s || !isObj(p) || typeof p.to !== "string" || !validSignal(p.data)) return;
        const target = s.room.players.get(p.to);
        if (!target?.socketId || target.id === s.playerId) return;
        socketOf(target.socketId)?.emit("rtc:signal", { from: s.playerId, data: p.data });
      }, signals),
    );

    socket.on(
      "game:loaded",
      guard((p) => {
        const s = session();
        if (s && isObj(p) && typeof p.round === "number" && (p.what === "sound" || p.what === "recordings")) s.room.onLoaded(s.playerId, p.round, p.what);
      }),
    );

    socket.on(
      "game:upload",
      guard((p, ack) => {
        const s = session();
        const reply = (r: { ok: true } | { ok: false; error: string }) => typeof ack === "function" && ack(r);
        if (!s || !isObj(p) || typeof p.round !== "number") return reply({ ok: false, error: "bad_request" });
        // كان المايك مكتومًا طوال التسجيل: لا نستقبل أي صوت أصلًا
        if (p.mutedAll === true) return reply(s.room.onUpload(s.playerId, p.round, null, true));
        let wav: Uint8Array | null = null;
        const raw = p.wav as unknown;
        if (raw instanceof Uint8Array) wav = raw;
        else if (raw instanceof ArrayBuffer) wav = new Uint8Array(raw);
        if (wav && (wav.byteLength > MAX_RECORDING_BYTES || wav.byteLength < 44)) return reply({ ok: false, error: "too_large" });
        reply(s.room.onUpload(s.playerId, p.round, wav ? new Uint8Array(wav) : null, false));
      }),
    );

    socket.on(
      "game:vote",
      guard((id) => {
        const s = session();
        if (s && typeof id === "string") s.room.vote(s.playerId, id);
      }),
    );

    socket.on(
      "wheel:pick",
      guard((id) => {
        const s = session();
        if (s && typeof id === "string") s.room.wheelPick(s.playerId, id);
      }),
    );

    socket.on("disconnect", () => {
      const s = session();
      sessions.delete(socket.id);
      if (s) s.room.disconnect(s.playerId, socket.id);
    });
  });

  return {
    manager,
    close() {
      manager.dispose();
    },
  };
}
