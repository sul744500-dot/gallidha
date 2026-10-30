// «مقلّد صناعي» للاختبار والمعايرة فقط: يأخذ منحنى طبقة الصوت والشدة من الصوت المرجعي
// ثم يعيد غناءه بحنجرة بشرية وحرف متحرك ثابت — تمامًا ما يفعله اللاعب عند التقليد (نفس اللحن والإيقاع، طابع مختلف).
// يسمح بمحاكاة صوت عميق/حاد، تسرّع/تباطؤ، وعدم إتقان، لاختبار عدالة التقييم.

import { SAMPLE_RATE } from "../constants";
import { rng } from "./dsp";
import { extractFeatures, HOP } from "./features";

export interface ImitateOptions {
  /** مضاعف طبقة الصوت (0.5 = أوكتاف أعمق) */
  pitchFactor?: number;
  /** مضاعف المدة (1.3 = أبطأ) */
  timeStretch?: number;
  /** عدم إتقان 0..1: انحراف طبقة عشوائي وتذبذب توقيت */
  sloppiness?: number;
  /** تسطيح اللحن 0..1 */
  flatten?: number;
  /** ضجيج خلفية بالديسيبل */
  noiseDb?: number;
  /** صمت قبل بدء التقليد (زمن رد الفعل) */
  leadMs?: number;
  vowel?: [number, number, number];
  /** المدى الصوتي للمقلّد بالهيرتز: البشر ينقلون اللحن لمداهم الطبيعي */
  range?: [number, number];
  seed?: number;
}

export function imitate(ref: Float32Array, refRate: number, o: ImitateOptions = {}): Float32Array {
  const sr = SAMPLE_RATE;
  const f = extractFeatures(ref, refRate);
  const r = rng(o.seed ?? 5);
  const stretchK = o.timeStretch ?? 1;
  const pf = o.pitchFactor ?? 1;
  const slop = o.sloppiness ?? 0;
  const flat = o.flatten ?? 0;
  const [F1, F2, F3] = o.vowel ?? [750, 1200, 2500];
  const lead = Math.round(((o.leadMs ?? 350) / 1000) * sr);
  const srcFrames = f.b - f.a;
  if (srcFrames <= 0) return new Float32Array(sr);
  const outFrames = Math.round(srcFrames * stretchK);
  const n = lead + outFrames * HOP + Math.round(0.4 * sr);
  const out = new Float32Array(n);

  // وسيط طبقة الصوت لتسطيح اللحن حوله
  const voicedVals: number[] = [];
  for (let t = f.a; t < f.b; t++) if (f.pitch[t] === f.pitch[t]) voicedVals.push(f.pitch[t]);
  voicedVals.sort((x, y) => x - y);
  const med = voicedVals.length ? voicedVals[voicedVals.length >> 1] : 30;
  // نقل اللحن كاملًا إلى مدى المقلّد (مثل ما يسوي أي شخص يقلد ديك بصوته)
  const [lo, hi] = o.range ?? [90, 520];
  const medHz = 55 * 2 ** (med / 12) * pf;
  const shift = 12 * Math.log2(Math.min(hi, Math.max(lo, medHz)) / medHz);
  let maxDb = -120;
  for (let t = f.a; t < f.b; t++) maxDb = Math.max(maxDb, f.db[t]);

  // انحراف عشوائي بطيء (random walk) يمثل عدم الإتقان
  let drift = 0;
  let phase = 0;
  let lp = 0;
  const res = [F1, F2, F3].map((fc, k) => {
    const bw = [90, 120, 180][k];
    const rr = Math.exp((-Math.PI * bw) / sr);
    return { a1: -2 * rr * Math.cos((2 * Math.PI * fc) / sr), a2: rr * rr, g: [1, 0.5, 0.25][k] * (1 - rr), y1: 0, y2: 0 };
  });
  let timeWarp = 0;
  for (let k = 0; k < outFrames; k++) {
    if (k % 10 === 0) drift = drift * 0.7 + (r() * 2 - 1) * 2.2 * slop;
    timeWarp = Math.max(-6, Math.min(6, timeWarp + (r() * 2 - 1) * 1.5 * slop));
    const srcPos = Math.min(srcFrames - 1, Math.max(0, Math.round(k / stretchK + timeWarp)));
    const t = f.a + srcPos;
    const st = f.pitch[t];
    const voiced = st === st;
    const amp = f.active[t] ? 10 ** ((f.db[t] - maxDb) / 20) : 0;
    const noisy = f.flatness[t] > 0.25 || !voiced;
    for (let i = 0; i < HOP; i++) {
      const idx = lead + k * HOP + i;
      let src = 0;
      if (voiced) {
        const semis = med + (st - med) * (1 - flat) + drift;
        const hz = 55 * 2 ** ((semis + shift) / 12) * pf;
        const dt = Math.min(0.45, hz / sr);
        phase += dt;
        if (phase >= 1) phase -= 1;
        // منشار محدود النطاق (polyBLEP) لتجنب التشوه الطيفي في الأصوات الحادة
        let blep = 0;
        if (phase < dt) {
          const x = phase / dt;
          blep = x + x - x * x - 1;
        } else if (phase > 1 - dt) {
          const x = (phase - 1) / dt;
          blep = x * x + x + x + 1;
        }
        src = 1 - 2 * phase + blep;
      }
      const nz = r() * 2 - 1;
      const exc = noisy ? (voiced ? src * 0.6 + nz * 0.5 : nz * 0.9) : src + nz * 0.05;
      lp += 0.25 * (exc - lp);
      let y = 0;
      for (const fl of res) {
        const v = fl.g * (voiced ? lp : exc) - fl.a1 * fl.y1 - fl.a2 * fl.y2;
        fl.y2 = fl.y1;
        fl.y1 = v;
        y += v;
      }
      out[idx] = y * amp * 6;
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.5 / peak : 1;
  const noiseAmp = 10 ** ((o.noiseDb ?? -55) / 20);
  for (let i = 0; i < n; i++) out[i] = out[i] * g + (r() * 2 - 1) * noiseAmp;
  return out;
}
