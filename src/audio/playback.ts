// تشغيل الصوت المرجعي والتسجيلات بتوقيت الخادم (كل الأجهزة بنفس اللحظة تقريبًا)،
// مع تطبيق مؤثر التخريب على التشغيل فقط بشكل حتمي (نفس الناتج عند الجميع).

import { applySabotage } from "../../shared/audio/effects";
import { resample } from "../../shared/audio/resample";
import { decodeWav } from "../../shared/audio/wav";
import { SAMPLE_RATE } from "../../shared/constants";
import type { SabotageId } from "../../shared/types";
import { msUntil } from "../lib/clock";
import { getBuses, getCtx, toAudioBuffer } from "./engine";

const refCache = new Map<string, Promise<AudioBuffer>>();

/** تحميل الصوت المرجعي وفكّه مسبقًا (يُبلَّغ الخادم بعدها أننا جاهزون) */
export function loadReference(url: string): Promise<AudioBuffer> {
  let p = refCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((ab) => {
        // نفك WAV بأنفسنا (متوافق مع كل المتصفحات) ثم نحوله لمعدل السياق
        const d = decodeWav(ab);
        return toAudioBuffer(d.samples, d.sampleRate, resample);
      });
    p.catch(() => refCache.delete(url));
    refCache.set(url, p);
  }
  return p;
}

export interface PlayHandle {
  stop(): void;
  /** يصدر عند انتهاء التشغيل */
  ended: Promise<void>;
  /** مستوى الصوت الحالي 0..1 (لحركة فم الشخصية) */
  level(): number;
  startedAt: number;
  duration: number;
}

let current: PlayHandle | null = null;
const lvl = new Float32Array(512);

/** تشغيل مخزن صوتي عند وقت خادم محدد؛ يوقف أي تشغيل سابق لمنع التداخل */
export function playAt(buffer: AudioBuffer, serverTime: number | null, bus: "game" | "sfx" = "game"): PlayHandle {
  current?.stop();
  const ctx = getCtx();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  analyser.connect(getBuses()[bus]);
  const delay = serverTime === null ? 0 : msUntil(serverTime) / 1000;
  let offset = 0;
  let when = ctx.currentTime;
  if (delay >= 0) when += delay;
  else offset = Math.min(buffer.duration, -delay); // وصلنا متأخرين: نكمل من نفس النقطة عند الجميع
  let stopped = false;
  const ended = new Promise<void>((resolve) => {
    src.onended = () => {
      if (current === handle) current = null;
      resolve();
    };
  });
  const startedAt = performance.now() + Math.max(0, delay) * 1000;
  const handle: PlayHandle = {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        src.stop();
      } catch {
        /* لم يبدأ بعد */
      }
    },
    ended,
    startedAt,
    duration: buffer.duration - offset,
    level() {
      if (stopped || performance.now() < startedAt) return 0;
      analyser.getFloatTimeDomainData(lvl);
      let e = 0;
      for (let i = 0; i < lvl.length; i++) e += lvl[i] * lvl[i];
      const db = 20 * Math.log10(Math.sqrt(e / lvl.length) + 1e-9);
      return Math.max(0, Math.min(1, (db + 55) / 45));
    },
  };
  if (offset < buffer.duration) src.start(when, offset);
  else queueMicrotask(() => src.onended?.(new Event("ended")));
  current = handle;
  return handle;
}

export function stopPlayback() {
  current?.stop();
  current = null;
}

export function currentPlayback() {
  return current;
}

/** تسجيلات الجولة: نحتفظ بالعينات النظيفة لتطبيق التخريب عند التشغيل */
export interface DecodedRecording {
  samples: Float32Array;
  durationMs: number;
}

export function decodeRecording(ab: ArrayBuffer): DecodedRecording {
  const d = decodeWav(ab);
  const samples = d.sampleRate === SAMPLE_RATE ? d.samples : resample(d.samples, d.sampleRate, SAMPLE_RATE);
  return { samples, durationMs: Math.round((samples.length / SAMPLE_RATE) * 1000) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** يجهز مخزن التشغيل مع مؤثر التخريب (البذرة من الجولة واللاعب لتطابق كل الأجهزة) */
export function buildPlayback(rec: DecodedRecording, sabotage: SabotageId | null, seedKey: string): AudioBuffer {
  const fx = applySabotage(sabotage, rec.samples, SAMPLE_RATE, hash(seedKey));
  return toAudioBuffer(fx, SAMPLE_RATE, resample);
}
