// «المخرج»: يربط حالة الخادم بالصوت على هذا الجهاز — بدون React.
// يحمّل الصوت المرجعي ويشغله بلحظة الخادم، يبدأ التسجيل ويوقفه بتوقيت الخادم ثم يرفعه،
// يجهز التسجيلات ويشغلها بالدور مع التخريب، ويقفل/يفتح الدردشة الصوتية حسب المرحلة.

import type { RoomView } from "../../shared/types";
import { mic } from "../audio/mic";
import { recorder } from "../audio/recorder";
import { voice } from "../audio/voice";
import { buildPlayback, loadReference, playAt, stopPlayback, type PlayHandle } from "../audio/playback";
import { msUntil } from "../lib/clock";
import { sfx } from "../lib/sfx";
import { createStore } from "../lib/store";
import { game } from "./client";

export interface DirectorSnapshot {
  /** التسجيل جارٍ الآن على هذا الجهاز */
  recording: boolean;
  uploadedRound: number;
  uploadError: boolean;
  /** معرّف اللاعب الذي يُشغَّل تسجيله الآن */
  playingId: string | null;
  refPlaying: boolean;
  refReady: boolean;
}

export const director = createStore<DirectorSnapshot>({ recording: false, uploadedRound: 0, uploadError: false, playingId: null, refPlaying: false, refReady: false });
const patch = (p: Partial<DirectorSnapshot>) => director.set((s) => ({ ...s, ...p }));

let handle: PlayHandle | null = null;
/** مفاتيح الأحداث المنفذة (حتى لا تتكرر مع كل تحديث للحالة) */
const done = new Set<string>();
const timers: ReturnType<typeof setTimeout>[] = [];
let lastSpeaking = false;
let lastMic = "";

function once(key: string, fn: () => void) {
  if (done.has(key)) return;
  done.add(key);
  if (done.size > 400) {
    const first = done.values().next().value;
    if (first) done.delete(first);
  }
  fn();
}

function at(serverTime: number, fn: () => void) {
  timers.push(setTimeout(fn, Math.max(0, msUntil(serverTime))));
}

/** مستوى «الصوت المسموع الآن» لكل لاعب (للشخصيات ثلاثية الأبعاد ومؤشر الكلام) */
export function liveLevel(playerId: string): number {
  const v = game.view;
  const d = director.get();
  if (d.playingId === playerId && handle) return handle.level();
  if (playerId === game.me) return v?.voiceOpen || d.recording ? mic.level() : 0;
  const l = voice.level(playerId);
  if (l > 0) return l;
  return game.speaking.get()[playerId] && v?.voiceOpen ? 0.5 + 0.3 * Math.sin(performance.now() / 70) : 0;
}

/** مستوى الصوت المرجعي (لشاشة الاستوديو) */
export function referenceLevel(): number {
  return director.get().refPlaying && handle ? handle.level() : 0;
}

function expectedAudio(v: RoomView): string[] | null {
  if (v.phase === "collect") return v.collect?.audio ?? null;
  if (v.phase === "reveal" && v.reveal) return null;
  return null;
}

function checkRecordingsLoaded(v: RoomView) {
  const ids = expectedAudio(v);
  if (!ids) return;
  if (ids.every((id) => game.recordings.has(`${v.round}:${id}`))) {
    once(`recloaded:${v.round}`, () => game.emit("game:loaded", { round: v.round, what: "recordings" }));
  }
}

async function doRecord(v: RoomView) {
  const rec = v.record!;
  const round = v.round;
  const ok = await recorder.prepare();
  if (!ok || !mic.ready) {
    // المايك غير متاح: نبلغ الخادم فورًا بدل انتظار المهلة
    const r = await game.upload(round, null, true);
    patch({ uploadedRound: round, uploadError: !r.ok });
    return;
  }
  at(rec.startAt, () => {
    if (game.view?.round !== round) return;
    recorder.start();
    patch({ recording: true });
  });
  at(rec.endAt, async () => {
    const out = await recorder.stop();
    patch({ recording: false });
    if (!out) return;
    const r = await game.upload(round, out.mutedAll ? null : out.wav, out.mutedAll);
    patch({ uploadedRound: round, uploadError: !r.ok });
    if (!r.ok && (r as { error: string }).error !== "duplicate") game.toast({ key: "toast.uploadFailed" });
  });
}

function onView(v: RoomView | null, prev: RoomView | null) {
  if (!v) {
    stopPlayback();
    recorder.cancel();
    patch({ recording: false, playingId: null, refPlaying: false });
    return;
  }
  const me = v.players.find((p) => p.id === game.me);

  // ── الدردشة الصوتية ──
  const others = v.players.filter((p) => p.connected && p.id !== game.me).map((p) => p.id);
  voice.sync(others, v.settings.voiceChat);
  voice.setBlocked(v.players.filter((p) => p.hostMuted || p.mic !== "on").map((p) => p.id));
  voice.setOpen(v.voiceOpen && !me?.hostMuted);

  // ── مرحلة جديدة ──
  const round = v.round;
  // مباراة جديدة (من الغرفة أو «العب مرة ثانية»): نمسح تسجيلات المباراة السابقة من الذاكرة
  if ((v.phase === "lobby" && prev && prev.phase !== "lobby") || (prev && v.round < prev.round)) {
    game.recordings.clear();
    done.clear();
  }

  if (v.sound && ["intro", "listen"].includes(v.phase)) {
    once(`preload:${round}:${v.sound.id}`, () => {
      patch({ refReady: false });
      loadReference(v.sound!.url)
        .then(() => {
          patch({ refReady: true });
          game.emit("game:loaded", { round, what: "sound" });
        })
        .catch(() => game.emit("game:loaded", { round, what: "sound" }));
    });
  }

  if (v.phase === "intro") once(`intro:${round}`, () => sfx("whoosh"));

  if (v.phase === "listen" && v.listenAt && v.sound) {
    once(`listen:${round}`, () => {
      loadReference(v.sound!.url)
        .then((buf) => {
          handle = playAt(buf, v.listenAt);
          at(v.listenAt!, () => patch({ refPlaying: true }));
          void handle.ended.then(() => patch({ refPlaying: false }));
        })
        .catch(() => {});
    });
  }

  if (v.phase === "countdown" && v.countdown) {
    once(`countdown:${round}`, () => {
      void recorder.prepare();
      const { steps, stepMs } = v.countdown!;
      for (let i = 0; i < steps; i++) at(v.phaseAt + i * stepMs, () => sfx("tick"));
      at(v.phaseAt + steps * stepMs, () => sfx("go"));
    });
  }

  if (v.phase === "record" && v.record && v.participants.includes(game.me)) {
    once(`record:${round}`, () => void doRecord(v));
  }

  if (v.phase === "collect") checkRecordingsLoaded(v);

  if (v.phase === "reveal" && v.reveal?.current) {
    const cur = v.reveal.current;
    const key = `${round}:${v.reveal.index}`;
    if (v.reveal.step === "intro") once(`rintro:${key}`, () => sfx("drum"));
    if (v.reveal.step === "play" && cur.hasAudio && cur.playAt) {
      once(`rplay:${key}`, () => {
        const rec = game.recordings.get(`${round}:${cur.playerId}`);
        if (!rec) return;
        try {
          const buf = buildPlayback(rec, cur.sabotage, `${v.code}:${round}:${cur.playerId}`);
          handle = playAt(buf, cur.playAt);
          at(cur.playAt!, () => patch({ playingId: cur.playerId }));
          const h = handle;
          void h.ended.then(() => {
            if (director.get().playingId === cur.playerId) patch({ playingId: null });
          });
        } catch (err) {
          console.warn("playback", err);
        }
      });
    }
    if (v.reveal.step === "score") {
      once(`rscore:${key}`, () => {
        patch({ playingId: null });
        const r = cur.result;
        if (r?.score === 100) sfx("fanfare");
        else if (r?.status === "ok" && (r.score ?? 0) >= 50) sfx("ding");
        else sfx("sad");
      });
    }
  }

  if (v.phase === "leaderboard") once(`lb:${round}`, () => sfx("pop"));
  if (v.phase === "final") once(`final:${v.rev}`, () => sfx("fanfare"));
  if (prev?.phase === "reveal" && v.phase !== "reveal") {
    stopPlayback();
    patch({ playingId: null });
  }
}

let prevView: RoomView | null = null;

export function startDirector() {
  game.store.subscribe(() => {
    const v = game.view;
    if (v === prevView) return;
    const prev = prevView;
    prevView = v;
    onView(v, prev);
  });
  game.recordingListeners.add(() => {
    const v = game.view;
    if (v) checkRecordingsLoaded(v);
  });
  // إبلاغ الخادم بحالة المايك عند تغيرها
  mic.store.subscribe(() => {
    const state = mic.micState();
    if (state !== lastMic && game.view) {
      lastMic = state;
      game.emit("player:mic", state);
    }
  });
  game.store.subscribe(() => {
    const state = mic.micState();
    if (game.view && state !== lastMic) {
      lastMic = state;
      game.emit("player:mic", state);
    }
  });
  // «يتكلم»: نرسل التغيرات فقط (للمؤشر عند الآخرين حتى لو الاتصال المباشر غير متاح)
  let hang = 0;
  setInterval(() => {
    const v = game.view;
    if (!v) return;
    const lvl = v.voiceOpen ? mic.level() : 0;
    if (lvl > 0.18) hang = 6;
    else if (hang > 0) hang--;
    const speaking = hang > 0;
    if (speaking !== lastSpeaking) {
      lastSpeaking = speaking;
      game.emit("player:speaking", speaking);
    }
  }, 60);
}

export function clearDirector() {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  done.clear();
}
