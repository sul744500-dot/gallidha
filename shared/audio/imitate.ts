// «مقلّد صناعي» للاختبار والمعايرة فقط: يأخذ منحنى طبقة الصوت والشدة من الصوت المرجعي
// ثم يعيد غناءه بحنجرة بشرية وحرف متحرك ثابت — تمامًا ما يفعله اللاعب عند التقليد (نفس اللحن والإيقاع، طابع مختلف).
// يسمح بمحاكاة صوت عميق/حاد، تسرّع/تباطؤ، وعدم إتقان، لاختبار عدالة التقييم.

import { SAMPLE_RATE } from "../constants";
import { rng } from "./dsp";
import { pitchShift } from "./effects";
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
  /**
   * همهمة: صوت مجهور متصل بلا حروف هامسة ولا احتكاك (يتبع اللحن والإيقاع فقط).
   * "umm" = «أممم أممم»: فتحة قصيرة عند بداية كل نغمة ثم إغلاق الشفتين على ميم.
   */
  hum?: boolean | "umm";
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
  const tune = (fl: (typeof res)[number], k: number, fc: number) => {
    const bw = [90, 120, 180][k];
    const rr = Math.exp((-Math.PI * bw) / sr);
    fl.a1 = -2 * rr * Math.cos((2 * Math.PI * fc) / sr);
  };
  // «أممم»: عدد الإطارات منذ بداية آخر نغمة (بعد صمت أو بداية مسجّلة)
  const since = new Int32Array(f.frames).fill(999);
  if (o.hum === "umm") {
    const starts = new Set(f.onsets);
    let c = 999;
    for (let t = 0; t < f.frames; t++) {
      if (starts.has(t) || (f.active[t] && (t === 0 || !f.active[t - 1]))) c = 0;
      since[t] = c++;
    }
  }
  const OPEN = [700, 1150, 2450];
  let timeWarp = 0;
  let lastSt = med;
  let ampS = 0;
  for (let k = 0; k < outFrames; k++) {
    if (k % 10 === 0) drift = drift * 0.7 + (r() * 2 - 1) * 2.2 * slop;
    timeWarp = Math.max(-6, Math.min(6, timeWarp + (r() * 2 - 1) * 1.5 * slop));
    const srcPos = Math.min(srcFrames - 1, Math.max(0, Math.round(k / stretchK + timeWarp)));
    const t = f.a + srcPos;
    let st = f.pitch[t];
    if (o.hum) {
      // الهمهمة تبقى مجهورة حتى مكان الحروف الهامسة، والحنجرة تنزلق بين النغمات
      // (لا تقفز مع أخطاء كشف الطبقة في الموسيقى: قفزة أكبر من 7 أنصاف درجة = خطأ كشف)
      if (st !== st || Math.abs(st - lastSt) > 7) st = lastSt;
      st = lastSt + (st - lastSt) * 0.35;
    }
    if (st === st) lastSt = st;
    const voiced = st === st;
    let amp = f.active[t] ? 10 ** ((f.db[t] - maxDb) / 20) : 0;
    const noisy = !o.hum && (f.flatness[t] > 0.25 || !voiced);
    if (o.hum === "umm") {
      // 90ms فتحة «أ» ثم انزلاق 60ms إلى «م» (الميم أهدأ بنحو 6dB)
      const s = since[t];
      const mix = s < 9 ? 0 : s < 15 ? (s - 9) / 6 : 1;
      [F1, F2, F3].forEach((fc, q) => tune(res[q], q, OPEN[q] * (1 - mix) + fc * mix));
      amp *= 1 - 0.5 * mix;
    }
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
      // انتقال ناعم للشدة داخل الإطار (الحنجرة لا تقفز كل 10ms فتصدر نقرات)
      ampS += (amp - ampS) * 0.004;
      out[idx] = y * ampS * 6;
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.5 / peak : 1;
  const noiseAmp = 10 ** ((o.noiseDb ?? -55) / 20);
  for (let i = 0; i < n; i++) out[i] = out[i] * g + (r() * 2 - 1) * noiseAmp;
  return out;
}

/**
 * «تقليد ممتاز» للاختبار: نفس الأداء (بالكلمات نفسها) بحنجرة أخرى (تغيير طبقة)،
 * وميكروفون آخر (تنعيم)، وضجيج غرفة خفيف، وتأخير بداية 0.3 ثانية.
 */
export function impersonate(x: Float32Array, semis: number, seed: number): Float32Array {
  const y = pitchShift(x, SAMPLE_RATE, semis);
  const out = new Float32Array(y.length + 4800);
  let lp = 0;
  let s = seed;
  for (let i = 0; i < y.length; i++) {
    lp += 0.55 * (y[i] - lp);
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i + 4800] = lp * 0.8 + ((s / 0x7fffffff) * 2 - 1) * 0.003;
  }
  return out;
}
