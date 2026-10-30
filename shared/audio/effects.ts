// مؤثرات التخريب الكوميدية: تُطبّق على تشغيل التسجيل فقط (التقييم يستخدم التسجيل النظيف دائمًا).
// كلها حتمية: نفس التسجيل + نفس البذرة = نفس الناتج على كل الأجهزة، والخادم يعرف مدة التشغيل مسبقًا.

import type { SabotageId } from "../types";
import { rng } from "./dsp";
import { resample } from "./resample";

export const SABOTAGES: SabotageId[] = ["chipmunk", "deep", "echo", "chop", "fast", "slow", "replace"];

const FAST = 1.7;
const SLOW = 0.62;
const ECHO_TAIL_MS = 1300;
export const REPLACE_MS = 2600;

/** مدة التشغيل بعد المؤثر */
export function sabotageDurationMs(id: SabotageId | null, durationMs: number): number {
  switch (id) {
    case "fast":
      return Math.round(durationMs / FAST);
    case "slow":
      return Math.round(durationMs / SLOW);
    case "echo":
      return durationMs + ECHO_TAIL_MS;
    case "replace":
      return REPLACE_MS;
    default:
      return durationMs;
  }
}

/** تغيير طبقة الصوت مع الحفاظ على المدة (قارئان على خط تأخير مع تلاشٍ متقاطع) */
export function pitchShift(x: Float32Array, sr: number, semitones: number): Float32Array {
  const p = 2 ** (semitones / 12);
  const W = Math.round(sr * 0.06);
  const out = new Float32Array(x.length);
  let phase = 0;
  const inc = (1 - p) / W;
  for (let n = 0; n < x.length; n++) {
    let acc = 0;
    for (let k = 0; k < 2; k++) {
      let ph = phase + k * 0.5;
      ph -= Math.floor(ph);
      const delay = ph * W;
      const pos = n - delay;
      const i = Math.floor(pos);
      const f = pos - i;
      const a = i >= 0 && i < x.length ? x[i] : 0;
      const b = i + 1 >= 0 && i + 1 < x.length ? x[i + 1] : 0;
      const g = Math.sin(Math.PI * ph) ** 2;
      acc += g * (a + (b - a) * f);
    }
    out[n] = acc;
    phase += inc;
    phase -= Math.floor(phase);
  }
  return out;
}

function speed(x: Float32Array, sr: number, factor: number): Float32Array {
  return resample(x, sr * factor, sr);
}

function echo(x: Float32Array, sr: number): Float32Array {
  const tail = Math.round((ECHO_TAIL_MS / 1000) * sr);
  const out = new Float32Array(x.length + tail);
  const D = Math.round(0.21 * sr);
  const D2 = Math.round(0.137 * sr);
  let lp = 0;
  for (let n = 0; n < out.length; n++) {
    const dry = n < x.length ? x[n] : 0;
    const fb = n >= D ? out[n - D] : 0;
    lp = lp + 0.45 * (fb - lp); // نعومة في التكرارات
    const early = n >= D2 && n - D2 < x.length ? x[n - D2] * 0.35 : 0;
    out[n] = dry + lp * 0.62 + early;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.98) for (let i = 0; i < out.length; i++) out[i] *= 0.98 / peak;
  return out;
}

function chop(x: Float32Array, sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const slice = Math.round(sr * 0.09);
  const fade = Math.round(sr * 0.004);
  const out = new Float32Array(x.length);
  let prevStart = 0;
  for (let s = 0; s < x.length; s += slice) {
    const roll = r();
    let src = s;
    let reverse = false;
    let silent = false;
    if (roll < 0.3 && s > 0) src = prevStart; // تأتأة: يكرر المقطع السابق
    else if (roll < 0.45) silent = true;
    else if (roll < 0.57) reverse = true;
    for (let i = 0; i < slice && s + i < x.length; i++) {
      if (silent) break;
      const idx = reverse ? src + slice - 1 - i : src + i;
      const v = idx >= 0 && idx < x.length ? x[idx] : 0;
      const env = Math.min(1, i / fade, (slice - 1 - i) / fade);
      out[s + i] = v * env;
    }
    if (!(roll < 0.3 && s > 0)) prevStart = s;
  }
  return out;
}

/** «ترومبون حزين» كوميدي يحل محل التسجيل */
export function sadTrombone(sr: number): Float32Array {
  const len = Math.round((REPLACE_MS / 1000) * sr);
  const out = new Float32Array(len);
  const notes = [
    { f: 233, start: 0, dur: 0.42 },
    { f: 220, start: 0.48, dur: 0.42 },
    { f: 207, start: 0.96, dur: 0.42 },
    { f: 196, start: 1.44, dur: 1.05 },
  ];
  for (const note of notes) {
    const s0 = Math.round(note.start * sr);
    const n = Math.round(note.dur * sr);
    let phase = 0;
    let lp = 0;
    for (let i = 0; i < n && s0 + i < len; i++) {
      const t = i / sr;
      const last = note === notes[notes.length - 1];
      const vib = last ? Math.sin(2 * Math.PI * 6 * t) * 0.025 * Math.min(1, t * 3) : 0;
      const f = note.f * (1 + vib) * (last ? 1 - 0.04 * t : 1);
      phase += f / sr;
      phase -= Math.floor(phase);
      const saw = 2 * phase - 1;
      // فلتر «واه» يفتح ويغلق مثل الكاتم في البوق
      const wah = 0.08 + 0.25 * Math.sin(Math.PI * Math.min(1, t / note.dur));
      lp += wah * (saw - lp);
      const env = Math.min(1, t / 0.03) * Math.min(1, (note.dur - t) / 0.08);
      out[s0 + i] += lp * env * 0.6;
    }
  }
  return out;
}

export function applySabotage(id: SabotageId | null, x: Float32Array, sr: number, seed = 1): Float32Array {
  switch (id) {
    case "chipmunk":
      return pitchShift(x, sr, 8);
    case "deep":
      return pitchShift(x, sr, -7);
    case "echo":
      return echo(x, sr);
    case "chop":
      return chop(x, sr, seed);
    case "fast":
      return speed(x, sr, FAST);
    case "slow":
      return speed(x, sr, SLOW);
    case "replace":
      return sadTrombone(sr);
    default:
      return x;
  }
}
