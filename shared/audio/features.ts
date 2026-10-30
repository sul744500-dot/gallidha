// استخراج خصائص صوتية حقيقية من إشارة PCM: الشدة، طبقة الصوت (YIN)، MFCC، التسطح الطيفي،
// المركز الطيفي، منحنى بدايات النبرات (spectral flux) ومقاطع النشاط.
// كل شيء حتمي وقابل للاختبار، ويعمل في Node والمتصفح بدون مكتبات خارجية.

import { SAMPLE_RATE } from "../constants";
import { dctMatrix, fft, hann, melBank, percentile } from "./dsp";
import { resample } from "./resample";

export const FRAME = 512; // 32ms
export const HOP = 160; // 10ms
export const N_MELS = 40;
export const N_MFCC = 13; // نحتفظ بـ c1..c12
const FMIN = 60;
const FMAX = 7600;
const YIN_W = 400; // 25ms
const F0_MIN = 70;
const F0_MAX = 1200;
const YIN_THRESHOLD = 0.15;
const VOICED_MAX_APERIODICITY = 0.22;

export interface FeatureStats {
  peakDb: number;
  floorDb: number;
  clipRatio: number;
  activeRatio: number;
  voicedRatio: number;
  dynRange: number;
  activeMs: number;
  durationMs: number;
}

export interface AudioFeatures {
  frames: number;
  /** شدة كل إطار بالديسيبل (dBFS) */
  db: Float32Array;
  logMel: Float32Array[];
  /** c1..c12 لكل إطار */
  mfcc: Float32Array[];
  flatness: Float32Array;
  /** log2 للمركز الطيفي بالهيرتز */
  centroid: Float32Array;
  /** طبقة الصوت بأنصاف النغمات فوق 55Hz، و NaN للإطار غير المجهور */
  pitch: Float32Array;
  onsetEnv: Float32Array;
  active: Uint8Array;
  /** بداية ونهاية منطقة النشاط [a, b) */
  a: number;
  b: number;
  onsets: number[];
  segments: [number, number][];
  stats: FeatureStats;
}

/** عتبة النشاط: نسبية لأعلى شدة مع حد أدنى مطلق، وتتعامل مع الأصوات الثابتة (مكنسة/محرك) */
function activityThreshold(db: Float32Array): { thr: number; floor: number; peak: number } {
  const floor = percentile(db, 10);
  const peak = percentile(db, 98);
  const range = peak - floor;
  let thr = range < 12 ? peak - 30 : Math.max(floor + 0.3 * range, peak - 30);
  thr = Math.max(thr, -55);
  return { thr, floor, peak };
}

function smoothMask(mask: Uint8Array, maxGap: number, minRun: number): Uint8Array {
  const out = mask.slice();
  const n = out.length;
  // سد الفجوات القصيرة
  let i = 0;
  while (i < n) {
    if (out[i]) {
      let j = i + 1;
      while (j < n && !out[j]) j++;
      if (j < n && j - i - 1 > 0 && j - i - 1 <= maxGap) for (let k = i + 1; k < j; k++) out[k] = 1;
      i = j;
    } else i++;
  }
  // حذف الجزر القصيرة
  i = 0;
  while (i < n) {
    if (out[i]) {
      let j = i;
      while (j < n && out[j]) j++;
      if (j - i < minRun) for (let k = i; k < j; k++) out[k] = 0;
      i = j;
    } else i++;
  }
  return out;
}

function runs(mask: Uint8Array): [number, number][] {
  const r: [number, number][] = [];
  let i = 0;
  while (i < mask.length) {
    if (mask[i]) {
      let j = i;
      while (j < mask.length && mask[j]) j++;
      r.push([i, j]);
      i = j;
    } else i++;
  }
  return r;
}

/** YIN لإطار واحد: يرجع [f0 بالهيرتز, درجة اللادورية] */
function yinFrame(seg: Float64Array, W: number, tauMin: number, tauMax: number, d: Float64Array, sr: number): [number, number] {
  let running = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) {
      const diff = seg[j] - seg[j + tau];
      s += diff * diff;
    }
    running += s;
    d[tau] = running > 0 ? (s * tau) / running : 1;
  }
  let found = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (d[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
      found = tau;
      break;
    }
  }
  if (found < 0) {
    let best = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < best) {
        best = d[tau];
        found = tau;
      }
    }
  }
  let refined = found;
  if (found > 1 && found < tauMax) {
    const a = d[found - 1];
    const b = d[found];
    const c = d[found + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-12) refined = found + (0.5 * (a - c)) / denom;
  }
  return [sr / refined, d[found]];
}

function medianFilterRuns(pitch: Float32Array, width: number) {
  const half = Math.floor(width / 2);
  const src = pitch.slice();
  let i = 0;
  const n = pitch.length;
  while (i < n) {
    if (src[i] === src[i]) {
      let j = i;
      while (j < n && src[j] === src[j]) j++;
      for (let k = i; k < j; k++) {
        const win: number[] = [];
        for (let q = Math.max(i, k - half); q <= Math.min(j - 1, k + half); q++) win.push(src[q]);
        win.sort((x, y) => x - y);
        pitch[k] = win[win.length >> 1];
      }
      i = j;
    } else i++;
  }
}

export function extractFeatures(input: Float32Array, inputRate = SAMPLE_RATE): AudioFeatures {
  const sr = SAMPLE_RATE;
  let clip = 0;
  for (let i = 0; i < input.length; i++) if (Math.abs(input[i]) >= 0.985) clip++;
  const clipRatio = input.length ? clip / input.length : 0;

  const raw = inputRate === sr ? input : resample(input, inputRate, sr);
  // إزالة الإزاحة المستمرة + مرشح تمرير عالٍ بسيط (~40Hz) لإزالة الطنين المنخفض
  const x = new Float32Array(raw.length);
  {
    let m = 0;
    for (let i = 0; i < raw.length; i++) m += raw[i];
    m = raw.length ? m / raw.length : 0;
    const alpha = Math.exp((-2 * Math.PI * 40) / sr);
    let prevIn = 0;
    let prevOut = 0;
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i] - m;
      const y = alpha * (prevOut + v - prevIn);
      prevIn = v;
      prevOut = y;
      x[i] = y;
    }
  }

  const n = x.length;
  const frames = Math.max(1, Math.floor(Math.max(0, n - FRAME) / HOP) + 1);
  const win = hann(FRAME);
  const bank = melBank(FRAME, sr, N_MELS, FMIN, FMAX);
  const dct = dctMatrix(N_MELS, N_MFCC);
  const binHz = sr / FRAME;
  const kLo = Math.ceil(100 / binHz);
  const kHi = Math.floor(7000 / binHz);

  const db = new Float32Array(frames);
  const flatness = new Float32Array(frames);
  const centroid = new Float32Array(frames);
  const logMel: Float32Array[] = [];
  const mfcc: Float32Array[] = [];
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const power = new Float64Array(FRAME / 2 + 1);

  for (let t = 0; t < frames; t++) {
    const start = t * HOP;
    let e = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = start + i < n ? x[start + i] : 0;
      e += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    db[t] = 20 * Math.log10(Math.sqrt(e / FRAME) + 1e-9);
    fft(re, im);
    for (let k = 0; k <= FRAME / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];

    const mel = new Float32Array(N_MELS);
    for (let m = 0; m < N_MELS; m++) {
      const { start: s0, weights } = bank.bands[m];
      let acc = 0;
      for (let q = 0; q < weights.length; q++) acc += weights[q] * power[s0 + q];
      mel[m] = Math.log(acc + 1e-10);
    }
    logMel.push(mel);
    const c = new Float32Array(N_MFCC - 1);
    for (let k = 1; k < N_MFCC; k++) {
      const row = dct[k];
      let acc = 0;
      for (let m = 0; m < N_MELS; m++) acc += row[m] * mel[m];
      c[k - 1] = acc;
    }
    mfcc.push(c);

    let logSum = 0;
    let linSum = 0;
    let wSum = 0;
    let fSum = 0;
    for (let k = kLo; k <= kHi; k++) {
      const p = power[k] + 1e-12;
      logSum += Math.log(p);
      linSum += p;
      wSum += p * k * binHz;
      fSum += p;
    }
    const cnt = kHi - kLo + 1;
    flatness[t] = Math.exp(logSum / cnt) / (linSum / cnt);
    centroid[t] = Math.log2(Math.max(50, wSum / (fSum || 1)));
  }

  // النشاط
  const { thr, floor, peak } = activityThreshold(db);
  const rawMask = new Uint8Array(frames);
  for (let t = 0; t < frames; t++) rawMask[t] = db[t] > thr ? 1 : 0;
  const active = smoothMask(rawMask, 6, 3);
  const segments = runs(active);
  const a = segments.length ? segments[0][0] : 0;
  const b = segments.length ? segments[segments.length - 1][1] : 0;
  let activeCount = 0;
  for (let t = 0; t < frames; t++) activeCount += active[t];

  // طبقة الصوت للإطارات النشطة فقط
  const pitch = new Float32Array(frames).fill(NaN);
  const tauMin = Math.floor(sr / F0_MAX);
  const tauMax = Math.ceil(sr / F0_MIN);
  const seg = new Float64Array(YIN_W + tauMax + 1);
  const dBuf = new Float64Array(tauMax + 1);
  let voiced = 0;
  for (let t = 0; t < frames; t++) {
    if (!active[t] || db[t] <= thr) continue;
    const center = t * HOP + FRAME / 2;
    const s0 = center - YIN_W / 2;
    for (let i = 0; i < seg.length; i++) {
      const idx = s0 + i;
      seg[i] = idx >= 0 && idx < n ? x[idx] : 0;
    }
    const [f0, ap] = yinFrame(seg, YIN_W, tauMin, tauMax, dBuf, sr);
    if (ap < VOICED_MAX_APERIODICITY && f0 >= F0_MIN && f0 <= F0_MAX) pitch[t] = 12 * Math.log2(f0 / 55);
  }
  medianFilterRuns(pitch, 5);
  // حذف المقاطع المجهورة القصيرة جدًا (أخطاء كشف)
  {
    let i = 0;
    while (i < frames) {
      if (pitch[i] === pitch[i]) {
        let j = i;
        while (j < frames && pitch[j] === pitch[j]) j++;
        if (j - i < 4) for (let k = i; k < j; k++) pitch[k] = NaN;
        else voiced += j - i;
        i = j;
      } else i++;
    }
  }

  // منحنى بدايات النبرات: التدفق الطيفي الموجب على طيف ميل اللوغاريتمي
  const flux = new Float32Array(frames);
  for (let t = 1; t < frames; t++) {
    let s = 0;
    const cur = logMel[t];
    const prev = logMel[t - 1];
    for (let m = 0; m < N_MELS; m++) {
      const dlt = cur[m] - prev[m];
      if (dlt > 0) s += dlt;
    }
    flux[t] = (s / N_MELS) * (active[t] || (t + 1 < frames && active[t + 1]) ? 1 : 0.2);
  }
  const onsetEnv = new Float32Array(frames);
  for (let t = 0; t < frames; t++) {
    const p = t > 0 ? flux[t - 1] : flux[t];
    const q = t + 1 < frames ? flux[t + 1] : flux[t];
    onsetEnv[t] = 0.25 * p + 0.5 * flux[t] + 0.25 * q;
  }
  const onsets = pickOnsets(onsetEnv, db, active, segments, a, b);

  return {
    frames,
    db,
    logMel,
    mfcc,
    flatness,
    centroid,
    pitch,
    onsetEnv,
    active,
    a,
    b,
    onsets,
    segments,
    stats: {
      peakDb: peak,
      floorDb: floor,
      clipRatio,
      activeRatio: activeCount / frames,
      voicedRatio: activeCount ? voiced / activeCount : 0,
      dynRange: peak - floor,
      activeMs: ((b - a) * HOP * 1000) / sr,
      durationMs: (n * 1000) / sr,
    },
  };
}

function pickOnsets(env: Float32Array, db: Float32Array, active: Uint8Array, segments: [number, number][], a: number, b: number): number[] {
  if (b <= a) return [];
  let max = 0;
  for (let t = a; t < b; t++) if (env[t] > max) max = env[t];
  const picks: number[] = [];
  if (max > 1e-6) {
    for (let t = Math.max(a, 1); t < Math.min(b, env.length - 1); t++) {
      const v = env[t];
      if (v < env[t - 1] || v < env[t + 1] || v < 0.12 * max) continue;
      let s = 0;
      let c = 0;
      for (let q = Math.max(a, t - 8); q <= Math.min(b - 1, t + 8); q++) {
        s += env[q];
        c++;
      }
      if (v <= s / c + 0.12 * max) continue;
      const near = t + 2 < active.length ? active[t] || active[t + 1] || active[t + 2] : active[t];
      if (!near) continue;
      // بداية نبرة حقيقية = ارتفاع في الشدة، وليس مجرد انزلاق في طبقة الصوت أو الحرف المتحرك
      let before = Infinity;
      let after = -Infinity;
      for (let q = Math.max(0, t - 4); q <= t; q++) before = Math.min(before, db[q]);
      for (let q = t; q <= Math.min(db.length - 1, t + 3); q++) after = Math.max(after, db[q]);
      if (after - before < 3) continue;
      const last = picks[picks.length - 1];
      if (last !== undefined && t - last < 7) {
        if (v > env[last]) picks[picks.length - 1] = t;
        continue;
      }
      picks.push(t);
    }
  }
  // بداية كل مقطع نشاط بعد صمت تعتبر بداية نبرة
  for (const [s] of segments) {
    if (!picks.some((p) => Math.abs(p - s) <= 5)) picks.push(s);
  }
  return picks.sort((x, y) => x - y);
}
