// مقارنة تسجيل اللاعب بالصوت المرجعي وإخراج درجة من 100.
// هذه خوارزمية معالجة إشارة (وليست نموذج ذكاء اصطناعي): محاذاة زمنية DTW على MFCC والشدة والتسطح الطيفي،
// ثم مقارنة منحنى طبقة الصوت بعد إلغاء الطبقة الطبيعية لكل شخص، والإيقاع، والتوقيت، والشدة.

import type { ScoreParts, ScoreResult, ScoreStatus } from "../types";
import { clamp, median, pearson, percentile, stretch } from "./dsp";
import { HOP, type AudioFeatures } from "./features";
import { SAMPLE_RATE } from "../constants";

export type Weights = ScoreParts;

export const DEFAULT_WEIGHTS: Weights = { pitch: 0.27, rhythm: 0.2, timing: 0.18, energy: 0.25, spectral: 0.1 };

/**
 * معايرة كل معيار: تحويل التشابه الخام (0..1) إلى درجة عرض.
 * lo = مستوى الصدفة تقريبًا (أصوات مختلفة)، hi = تقليد ممتاز. القيم من scripts/calibrate.ts
 */
export const CALIBRATION: Record<keyof ScoreParts, { lo: number; hi: number }> = {
  pitch: { lo: 0.42, hi: 0.86 },
  rhythm: { lo: 0.36, hi: 0.82 },
  timing: { lo: 0.42, hi: 0.95 },
  energy: { lo: 0.25, hi: 0.85 },
  spectral: { lo: 0.3, hi: 0.56 },
};

const FRAME_SEC = HOP / SAMPLE_RATE;

/** فحص جودة التسجيل قبل التقييم: لا نخترع درجة لتسجيل صامت أو تالف */
export function assessQuality(f: AudioFeatures): ScoreStatus {
  const s = f.stats;
  if (f.frames < 5 || !Number.isFinite(s.peakDb)) return "corrupt";
  if (s.peakDb < -50 || s.activeMs < 60) return "silent";
  if (s.activeMs < 180) return "too_short";
  if (s.clipRatio > 0.04) return "clipped";
  if (s.dynRange < 8 && s.peakDb < -36 && s.activeRatio > 0.9) return "noisy";
  return "ok";
}

interface Dtw {
  dist: number;
  path: [number, number][];
}

function zStats(rows: Float32Array[][], dims: number, floors: number[]): { mean: number[]; sd: number[] } {
  // rows: مجموعات الإطارات (المرجع والتسجيل) — الانحراف المعياري مشترك والمتوسط لكل إشارة على حدة
  const sd: number[] = [];
  for (let d = 0; d < dims; d++) {
    let s = 0;
    let s2 = 0;
    let c = 0;
    for (const set of rows) {
      let m = 0;
      for (const r of set) m += r[d];
      m /= set.length || 1;
      for (const r of set) {
        const v = r[d] - m;
        s += v;
        s2 += v * v;
        c++;
      }
    }
    const variance = c ? s2 / c - (s / c) ** 2 : 0;
    sd.push(Math.max(Math.sqrt(Math.max(0, variance)), floors[d]));
  }
  return { mean: [], sd };
}

/** متجه خصائص لكل إطار نشط لاستخدامه في DTW */
function frameVectors(f: AudioFeatures): Float32Array[] {
  const out: Float32Array[] = [];
  const nC = f.mfcc[0]?.length ?? 12;
  // تطبيع متوسط الكبسترم (CMN) يزيل أثر الميكروفون وطابع الحنجرة الثابت
  const cm = new Float64Array(nC);
  let cnt = 0;
  let maxDb = -Infinity;
  let cenMean = 0;
  for (let t = f.a; t < f.b; t++) {
    for (let k = 0; k < nC; k++) cm[k] += f.mfcc[t][k];
    if (f.db[t] > maxDb) maxDb = f.db[t];
    cenMean += f.centroid[t];
    cnt++;
  }
  for (let k = 0; k < nC; k++) cm[k] /= cnt || 1;
  cenMean /= cnt || 1;
  for (let t = f.a; t < f.b; t++) {
    const v = new Float32Array(nC + 3);
    for (let k = 0; k < nC; k++) v[k] = f.mfcc[t][k] - cm[k];
    v[nC] = Math.sqrt(f.flatness[t]);
    v[nC + 1] = Math.max(-60, f.db[t] - maxDb);
    v[nC + 2] = f.centroid[t] - cenMean;
    out.push(v);
  }
  return out;
}

function dtw(A: Float32Array[], B: Float32Array[], weights: number[], sd: number[]): Dtw {
  const n = A.length;
  const m = B.length;
  const dims = weights.length;
  let wTot = 0;
  for (const w of weights) wTot += w;
  const inv = weights.map((w, d) => w / (sd[d] * sd[d]) / wTot);
  const local = (i: number, j: number) => {
    const a = A[i];
    const b = B[j];
    let s = 0;
    for (let d = 0; d < dims; d++) {
      const diff = a[d] - b[d];
      s += diff * diff * inv[d];
    }
    return Math.sqrt(s);
  };
  const band = 0.3; // انحراف مسموح عن القطر بالزمن المطبّع
  const D = new Float64Array(n * m).fill(Infinity);
  const dir = new Uint8Array(n * m);
  for (let i = 0; i < n; i++) {
    const ri = n > 1 ? i / (n - 1) : 0;
    for (let j = 0; j < m; j++) {
      const rj = m > 1 ? j / (m - 1) : 0;
      if (Math.abs(ri - rj) > band && !(i === 0 && j === 0) && !(i === n - 1 && j === m - 1)) continue;
      const d = local(i, j);
      const idx = i * m + j;
      if (i === 0 && j === 0) {
        D[idx] = 2 * d;
        continue;
      }
      let best = Infinity;
      let bd = 0;
      if (i > 0 && j > 0 && D[idx - m - 1] + 2 * d < best) {
        best = D[idx - m - 1] + 2 * d;
        bd = 0;
      }
      if (i > 0 && D[idx - m] + d < best) {
        best = D[idx - m] + d;
        bd = 1;
      }
      if (j > 0 && D[idx - 1] + d < best) {
        best = D[idx - 1] + d;
        bd = 2;
      }
      D[idx] = best;
      dir[idx] = bd;
    }
  }
  const total = D[n * m - 1];
  if (!Number.isFinite(total)) return { dist: 2, path: [] };
  const path: [number, number][] = [];
  let i = n - 1;
  let j = m - 1;
  while (i >= 0 && j >= 0) {
    path.push([i, j]);
    if (i === 0 && j === 0) break;
    const d = dir[i * m + j];
    if (d === 0) {
      i--;
      j--;
    } else if (d === 1) i--;
    else j--;
    if (i < 0 || j < 0) break;
  }
  path.reverse();
  return { dist: total / (n + m), path };
}

function gaussTrain(onsets: number[], len: number, sigma: number): Float64Array {
  const out = new Float64Array(len);
  for (const o of onsets) {
    const c = o * (len - 1);
    for (let i = Math.max(0, Math.floor(c - 4 * sigma)); i <= Math.min(len - 1, Math.ceil(c + 4 * sigma)); i++) {
      out[i] += Math.exp(-((i - c) ** 2) / (2 * sigma * sigma));
    }
  }
  return out;
}

function cosine(a: Float64Array, b: Float64Array, shift: number): number {
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const j = i + shift;
    const bv = j >= 0 && j < b.length ? b[j] : 0;
    num += a[i] * bv;
    da += a[i] * a[i];
    db += bv * bv;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** دورية منحنى الشدة (للأصوات المتكررة مثل بوك بوك بوك) */
function periodicity(db: Float32Array, a: number, b: number): { lag: number; strength: number } {
  const n = b - a;
  if (n < 30) return { lag: 0, strength: 0 };
  const x = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) m += db[a + i];
  m /= n;
  for (let i = 0; i < n; i++) x[i] = db[a + i] - m;
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += x[i] * x[i];
  if (e0 < 1e-6) return { lag: 0, strength: 0 };
  const maxLag = Math.min(80, Math.floor(n / 2));
  const peaks: [number, number][] = [];
  let prev = 1;
  let descending = true;
  const rs: number[] = [];
  for (let lag = 6; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    rs.push(s / e0);
  }
  for (let k = 0; k < rs.length; k++) {
    const r = rs[k];
    if (descending) {
      if (r > prev) descending = false;
      prev = r;
      continue;
    }
    if (k > 0 && k + 1 < rs.length && r >= rs[k - 1] && r >= rs[k + 1]) peaks.push([k + 6, r]);
  }
  const best = peaks.length ? Math.max(...peaks.map((p) => p[1])) : 0;
  if (best <= 0) return { lag: 0, strength: 0 };
  // أول قمة قوية = الدورة الأساسية (لا نخلط بين المقطع ومضاعفاته)
  const first = peaks.find((p) => p[1] >= 0.85 * best)!;
  return { lag: first[0], strength: best };
}

function onsetF1(ref: number[], rec: number[], tol: number): number {
  if (!ref.length && !rec.length) return 1;
  if (!ref.length || !rec.length) return 0;
  const used = new Set<number>();
  let hit = 0;
  for (const r of ref) {
    let best = -1;
    let bd = Infinity;
    rec.forEach((u, idx) => {
      const d = Math.abs(u - r);
      if (!used.has(idx) && d <= tol && d < bd) {
        bd = d;
        best = idx;
      }
    });
    if (best >= 0) {
      used.add(best);
      hit++;
    }
  }
  const p = hit / rec.length;
  const r = hit / ref.length;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

export interface CompareOptions {
  weights?: Partial<Weights>;
}

function display(part: keyof ScoreParts, sim: number): number {
  const { lo, hi } = CALIBRATION[part];
  return Math.round(100 * clamp((sim - lo) / (hi - lo), 0, 1));
}

/** هل التسجيل نسخة طبق الأصل من الملف المرجعي (تشغيل الصوت للمايك بدل تقليده)؟ */
export function replayLikelihood(ref: AudioFeatures, rec: AudioFeatures): number {
  // نمسح التسجيل كاملًا بحثًا عن نسخة من طيف المرجع (مهما كان التأخير أو مستوى الصوت أو الضجيج الخفيف)
  const n = ref.b - ref.a;
  if (n < 10) return 0;
  const minOverlap = Math.ceil(n * 0.7);
  // أرضية نسبية (-40dB تحت القمة) حتى لا يُفسد ضجيج الغرفة الخفيف المقارنة في النطاقات الصامتة
  const ceilOf = (f: AudioFeatures) => {
    let mx = -Infinity;
    for (const row of f.logMel) for (let k = 2; k < row.length; k++) if (row[k] > mx) mx = row[k];
    return mx - 9.21;
  };
  const floorR = ceilOf(ref);
  const floorU = ceilOf(rec);
  const corrAt = (lag: number): number => {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let c = 0;
    for (let i = ref.a; i < ref.b; i++) {
      const j = i + lag;
      if (j < 0 || j >= rec.frames) continue;
      const r = ref.logMel[i];
      const u = rec.logMel[j];
      for (let k = 2; k < r.length; k++) {
        const x = r[k] > floorR ? r[k] : floorR;
        const y = u[k] > floorU ? u[k] : floorU;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
        c++;
      }
    }
    if (c < minOverlap * 30) return 0;
    const cov = sxy - (sx * sy) / c;
    const vx = sxx - (sx * sx) / c;
    const vy = syy - (sy * sy) / c;
    return vx > 1e-9 && vy > 1e-9 ? cov / Math.sqrt(vx * vy) : 0;
  };
  const lo = -ref.b + minOverlap;
  const hi = rec.frames - ref.a - minOverlap;
  let best = 0;
  let bestLag = 0;
  for (let lag = lo; lag <= hi; lag += 3) {
    const c = corrAt(lag);
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  for (let lag = bestLag - 2; lag <= bestLag + 2; lag++) {
    const c = corrAt(lag);
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  if (best < 0.8) return best;
  // تأكيد ثانٍ: نفس «الطابع» (غلاف الطيف MFCC). المقلّد الماهر قد يطابق اللحن والإيقاع،
  // لكن حنجرة الإنسان لا تطابق طابع الملف الأصلي — أما التشغيل من سماعة فيطابقه.
  const mean = (f: AudioFeatures, from: number, to: number) => {
    const m = new Float64Array(f.mfcc[0].length);
    for (let t = from; t < to; t++) for (let k = 0; k < m.length; k++) m[k] += f.mfcc[t][k];
    for (let k = 0; k < m.length; k++) m[k] /= Math.max(1, to - from);
    return m;
  };
  const from = Math.max(ref.a, -bestLag);
  const to = Math.min(ref.b, rec.frames - bestLag);
  if (to - from < minOverlap) return 0;
  const mr = mean(ref, from, to);
  const mu = mean(rec, from + bestLag, to + bestLag);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let t = from; t < to; t++) {
    if (ref.db[t] < ref.stats.peakDb - 30) continue;
    for (let k = 0; k < mr.length; k++) {
      xs.push(ref.mfcc[t][k] - mr[k]);
      ys.push(rec.mfcc[t + bestLag][k] - mu[k]);
    }
  }
  const timbre = pearson(xs, ys);
  return Math.min(best, timbre);
}

export function compareFeatures(ref: AudioFeatures, rec: AudioFeatures, opts: CompareOptions = {}): ScoreResult {
  const status = assessQuality(rec);
  if (status !== "ok") return { status, score: null, parts: null };
  if (ref.b - ref.a < 5) return { status: "corrupt", score: null, parts: null };

  const replay = replayLikelihood(ref, rec);
  if (replay > 0.85) return { status: "suspicious", score: null, parts: null, debug: { replay } };

  const n = ref.b - ref.a;
  const m = rec.b - rec.a;
  const R = frameVectors(ref);
  const U = frameVectors(rec);
  const dims = R[0].length;
  const nC = dims - 3;
  const weights = [...Array(nC).fill(0.5), 3, 4, 1.5];
  const floors = [...Array(nC).fill(1.5), 0.04, 4, 0.15];
  const { sd } = zStats([R, U], dims, floors);
  const { dist, path } = dtw(R, U, weights, sd);
  const spectralSim = clamp(1 - dist / 1.4, 0, 1);

  // ---- طبقة الصوت: نطرح الوسيط لكل طرف فلا يُعاقب صاحب الصوت العميق أو الحاد ----
  let refVoiced = 0;
  for (let t = ref.a; t < ref.b; t++) if (ref.pitch[t] === ref.pitch[t]) refVoiced++;
  const refVoicedRatio = refVoiced / n;
  let agree = 0;
  const pr: number[] = [];
  const pu: number[] = [];
  for (const [i, j] of path) {
    const vr = ref.pitch[ref.a + i];
    const vu = rec.pitch[rec.a + j];
    const isR = vr === vr;
    const isU = vu === vu;
    if (isR === isU) agree++;
    if (isR && isU) {
      pr.push(vr);
      pu.push(vu);
    }
  }
  const voicingAgreement = path.length ? agree / path.length : 0;
  let pitchSim: number;
  let pitchErr = NaN;
  let pitchWeightScale = 1;
  if (refVoicedRatio < 0.15) {
    // صوت بلا طبقة واضحة (عطسة، مكنسة، فحيح): المهم ألا يحوّله اللاعب لغناء
    pitchSim = voicingAgreement;
    pitchWeightScale = 0.4;
  } else if (pr.length < 8) {
    pitchSim = 0.35 * voicingAgreement;
  } else {
    const mr = median(pr);
    const mu = median(pu);
    const rc = pr.map((v) => v - mr);
    const uc = pu.map((v) => v - mu);
    let best = Infinity;
    const errs = new Float64Array(rc.length);
    const keep = Math.max(1, Math.round(rc.length * 0.94));
    for (const s of [0.6, 0.7, 0.8, 0.9, 1, 1.12, 1.25, 1.4, 1.6]) {
      for (let k = 0; k < rc.length; k++) {
        // نتسامح مع خطأ الأوكتاف الواحد (طبقة مضاعفة/منصّفة في الكشف)
        const d = Math.abs(rc[k] - s * uc[k]);
        errs[k] = Math.min(d, Math.abs(d - 12) + 1.5, 7);
      }
      // متوسط مقصوص: نتجاهل أسوأ 15% (انتقالات بين المقاطع وأخطاء كشف عابرة)
      errs.sort();
      let e = 0;
      for (let k = 0; k < keep; k++) e += errs[k];
      e = e / keep + 1.8 * Math.abs(Math.log2(s));
      if (e < best) best = e;
    }
    pitchErr = best;
    pitchSim = 0.75 * Math.exp(-best / 2.6) + 0.25 * voicingAgreement;
  }

  // ---- الشدة ----
  const refDb = ref.db.subarray(ref.a, ref.b);
  const recDb = rec.db.subarray(rec.a, rec.b);
  const corrLin = pearson(stretch(refDb, 120), stretch(recDb, 120));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [i, j] of path) {
    xs.push(refDb[i]);
    ys.push(recDb[j]);
  }
  const corrPath = pearson(xs, ys);
  const rangeR = percentile(refDb, 95) - percentile(refDb, 10);
  const rangeU = percentile(recDb, 95) - percentile(recDb, 10);
  const rangeSim = Math.exp(-Math.abs(rangeR - rangeU) / 30);
  const energySim = 0.55 * Math.max(0, corrLin) + 0.25 * Math.max(0, corrPath) + 0.2 * rangeSim;

  // ---- الإيقاع (نمط البدايات بعد تطبيع المدة، عددها، الدورية) ----
  const oR = ref.onsets.filter((o) => o >= ref.a && o < ref.b).map((o) => (o - ref.a) / Math.max(1, n - 1));
  const oU = rec.onsets.filter((o) => o >= rec.a && o < rec.b).map((o) => (o - rec.a) / Math.max(1, m - 1));
  let pattern: number;
  if (oR.length <= 1 && oU.length <= 1) pattern = 1;
  else {
    const gR = gaussTrain(oR, 200, 4);
    const gU = gaussTrain(oU, 200, 4);
    pattern = 0;
    for (let sh = -10; sh <= 10; sh++) pattern = Math.max(pattern, cosine(gR, gU, sh));
  }
  const countSim = Math.exp(-Math.abs(oR.length - oU.length) / Math.max(1.2, 0.3 * oR.length));
  const segR = ref.segments.length;
  const segU = rec.segments.length;
  const segSim = Math.exp(-Math.abs(segR - segU) / Math.max(1, 0.3 * segR));
  const perR = periodicity(ref.db, ref.a, ref.b);
  const perU = periodicity(rec.db, rec.a, rec.b);
  const strongR = perR.strength > 0.35;
  const strongU = perU.strength > 0.35;
  let periodSim: number;
  if (strongR && strongU) periodSim = Math.exp(-Math.abs(Math.log(perR.lag / perU.lag)) / 0.3);
  else if (!strongR && !strongU) periodSim = 0.8;
  else periodSim = 0.35;
  const rhythmSim = 0.35 * pattern + 0.25 * countSim + 0.15 * segSim + 0.25 * periodSim;

  // ---- التوقيت (المدة الفعلية + توقيت البدايات بالثواني) ----
  const durSim = Math.exp(-Math.abs(Math.log(m / n)) / 0.5);
  const tR = ref.onsets.filter((o) => o >= ref.a && o < ref.b).map((o) => (o - ref.a) * FRAME_SEC);
  const tU = rec.onsets.filter((o) => o >= rec.a && o < rec.b).map((o) => (o - rec.a) * FRAME_SEC);
  const tol = 0.12 + 0.08 * n * FRAME_SEC;
  const f1 = onsetF1(tR, tU, tol);
  const timingSim = 0.55 * durSim + 0.45 * f1;

  const sims: ScoreParts = { pitch: pitchSim, rhythm: rhythmSim, timing: timingSim, energy: energySim, spectral: spectralSim };
  const parts: ScoreParts = {
    pitch: display("pitch", pitchSim),
    rhythm: display("rhythm", rhythmSim),
    timing: display("timing", timingSim),
    energy: display("energy", energySim),
    spectral: display("spectral", spectralSim),
  };
  const w: Weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  w.pitch *= pitchWeightScale;
  let num = 0;
  let den = 0;
  for (const k of Object.keys(parts) as (keyof ScoreParts)[]) {
    num += w[k] * parts[k];
    den += w[k];
  }
  // باقي المعايير تطبّع الزمن، فالمدة المختلفة جدًا (مثل 1.3 ث مقابل 2.3 ث) تُخصم من الإجمالي
  const durFactor = 0.55 + 0.45 * clamp((durSim - 0.3) / 0.45, 0, 1);
  const score = Math.round(clamp((num / (den || 1)) * durFactor, 0, 100));
  return {
    status: "ok",
    score,
    parts,
    debug: {
      dist,
      replay,
      refVoicedRatio,
      voicingAgreement,
      pitchErr,
      corrLin,
      corrPath,
      rangeSim,
      pattern,
      countSim,
      segSim,
      periodSim,
      durSim,
      f1,
      onsetsRef: oR.length,
      onsetsRec: oU.length,
      ...Object.fromEntries(Object.entries(sims).map(([k, v]) => [`sim_${k}`, v])),
    },
  };
}
