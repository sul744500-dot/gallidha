// محرك توليف صوتي إجرائي صغير لصنع مكتبة أصوات أصلية 100% (لا تسجيلات منسوخة):
// مذبذبات محدودة النطاق، مصدر صوتي حنجري، مرشحات رنين (فورمانت) للحروف المتحركة، ضجيج، أغلفة، صدى.

import { rng } from "../../shared/audio/dsp";

export const SR = 22050;

export type Pts = [number, number][];
export type Curve = number | Pts | ((t: number) => number);

export const len = (dur: number) => Math.max(1, Math.round(dur * SR));
export const silence = (dur: number) => new Float32Array(len(dur));

/** قيمة منحنى عند زمن t (نقاط بالاستيفاء الخطي) */
export function at(c: Curve, t: number): number {
  if (typeof c === "number") return c;
  if (typeof c === "function") return c(t);
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i][0]) {
      const [t0, v0] = c[i - 1];
      const [t1, v1] = c[i];
      return v0 + (v1 - v0) * ((t - t0) / Math.max(1e-9, t1 - t0));
    }
  }
  return c[c.length - 1][1];
}

/** مثل at لكن بالاستيفاء اللوغاريتمي (أنسب للترددات) */
export function atLog(c: Curve, t: number): number {
  if (typeof c !== "object") return at(c, t);
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i][0]) {
      const [t0, v0] = c[i - 1];
      const [t1, v1] = c[i];
      const f = (t - t0) / Math.max(1e-9, t1 - t0);
      return Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * f);
    }
  }
  return c[c.length - 1][1];
}

export function envelope(dur: number, pts: Pts): Float32Array {
  const out = new Float32Array(len(dur));
  for (let i = 0; i < out.length; i++) out[i] = at(pts, i / SR);
  return out;
}

export function applyEnv(x: Float32Array, pts: Pts): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * at(pts, i / SR);
  return out;
}

export function gain(x: Float32Array, g: Curve): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * at(g, i / SR);
  return out;
}

export function noise(dur: number, color: "white" | "pink" | "brown" = "white", seed = 1): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(len(dur));
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let brown = 0;
  for (let i = 0; i < out.length; i++) {
    const w = r() * 2 - 1;
    if (color === "white") out[i] = w;
    else if (color === "pink") {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      out[i] = brown * 3.5;
    }
  }
  return out;
}

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export type Shape = "sine" | "saw" | "square" | "tri" | "pulse";

export function osc(dur: number, freq: Curve, shape: Shape = "sine", duty: Curve = 0.5, phase0 = 0): Float32Array {
  const out = new Float32Array(len(dur));
  let phase = phase0;
  let tri = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = atLog(freq, t);
    const dt = Math.min(0.49, f / SR);
    let v: number;
    if (shape === "sine") v = Math.sin(2 * Math.PI * phase);
    else if (shape === "saw") v = 2 * phase - 1 - polyBlep(phase, dt);
    else {
      const d = shape === "pulse" ? at(duty, t) : 0.5;
      v = phase < d ? 1 : -1;
      v += polyBlep(phase, dt);
      v -= polyBlep((phase + 1 - d) % 1, dt);
      if (shape === "tri") {
        tri = dt * v * 4 + (1 - dt * 4) * tri;
        v = tri;
      }
    }
    out[i] = v;
    phase += f / SR;
    phase -= Math.floor(phase);
  }
  return out;
}

export interface VoiceOpts {
  /** تذبذب عشوائي لطول الدورة (نسبة) */
  jitter?: number;
  /** تذبذب عشوائي لسعة الدورة */
  shimmer?: number;
  vibRate?: number;
  /** عمق الاهتزاز بأنصاف النغمات */
  vibDepth?: Curve;
  /** نسبة النفَس/الهواء 0..1 */
  breath?: Curve;
  /** قطع الترددات العالية للمصدر (Hz) — أقل = صوت أنعم */
  tilt?: Curve;
  /** خشونة: توافقيات تحتية (تبادل سعة الدورات) 0..1 */
  rough?: Curve;
  seed?: number;
}

/** مصدر صوتي يشبه الحنجرة: نبضات غنية بالتوافقيات + نفَس، مع اهتزاز وخشونة */
export function voiceSource(dur: number, f0: Curve, o: VoiceOpts = {}): Float32Array {
  const r = rng(o.seed ?? 7);
  const out = new Float32Array(len(dur));
  let phase = 0;
  let jit = 1;
  let shim = 1;
  let parity = 1;
  let lp = 0;
  let lp2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const vib = o.vibRate ? Math.sin(2 * Math.PI * o.vibRate * t) * at(o.vibDepth ?? 0.3, t) : 0;
    const f = atLog(f0, t) * 2 ** (vib / 12) * jit;
    const dt = Math.min(0.45, f / SR);
    let saw = 2 * phase - 1 - polyBlep(phase, dt);
    // شكل نبضة الحنجرة: نقلب المنشار ونقطع جزءه الموجب لنقترب من نبضة الإغلاق
    saw = -saw;
    const rough = at(o.rough ?? 0, t);
    let v = saw * shim * (1 + rough * 0.8 * parity);
    const breath = at(o.breath ?? 0.05, t);
    const n = (r() * 2 - 1) * (0.4 + 0.6 * (phase < 0.5 ? 1 : 0.3));
    v = v * (1 - breath * 0.7) + n * breath * 0.9;
    const tilt = at(o.tilt ?? 3000, t);
    const a = 1 - Math.exp((-2 * Math.PI * tilt) / SR);
    lp += a * (v - lp);
    lp2 += a * (lp - lp2);
    out[i] = lp2 * 0.6 + lp * 0.4;
    phase += f / SR;
    if (phase >= 1) {
      phase -= 1;
      jit = 1 + (r() * 2 - 1) * (o.jitter ?? 0.005);
      shim = 1 + (r() * 2 - 1) * (o.shimmer ?? 0.05);
      parity = -parity;
    }
  }
  return out;
}

export interface Formant {
  f: number;
  bw: number;
  g: number;
}
export type FormantTrack = (t: number) => Formant[];

/** ترددات الرنين (F1, F2, F3) لبعض الحروف المتحركة والأصوات */
export const VOWELS: Record<string, [number, number, number]> = {
  a: [800, 1250, 2550],
  ae: [690, 1700, 2500],
  e: [480, 1900, 2600],
  i: [310, 2250, 3000],
  o: [520, 880, 2450],
  u: [340, 760, 2250],
  schwa: [520, 1450, 2500],
  m: [270, 1050, 2250],
  l: [360, 1300, 2700],
  w: [300, 650, 2200],
};

/** مسار حروف متحركة عبر الزمن مع استيفاء ترددات الرنين؛ scale>1 لكائن أصغر */
export function vowels(seq: [number, string][], scale = 1, gains: [number, number, number] = [1, 0.55, 0.3], bws: [number, number, number] = [90, 110, 170]): FormantTrack {
  return (t: number) => {
    let i = 0;
    while (i + 1 < seq.length && seq[i + 1][0] <= t) i++;
    const [t0, v0] = seq[i];
    const next = seq[i + 1];
    const A = VOWELS[v0];
    let F = A;
    if (next) {
      const B = VOWELS[next[1]];
      const f = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, next[0] - t0)));
      F = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
    }
    const nasal = v0 === "m" && (!next || next[0] - t > 0.05);
    return F.map((freq, k) => ({ f: freq * scale, bw: bws[k] * scale, g: gains[k] * (nasal && k > 0 ? 0.25 : 1) }));
  };
}

/** بنك مرشحات تمرير نطاق متوازية متغيرة مع الزمن */
export function formantFilter(src: Float32Array, track: FormantTrack, block = 32): Float32Array {
  const out = new Float32Array(src.length);
  const nF = track(0).length;
  const state = Array.from({ length: nF }, () => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
  let coefs: { b0: number; a1: number; a2: number; g: number }[] = [];
  for (let i = 0; i < src.length; i++) {
    if (i % block === 0) {
      coefs = track(i / SR).map(({ f, bw, g }) => {
        const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
        const q = Math.max(0.5, f / Math.max(20, bw));
        const alpha = Math.sin(w) / (2 * q);
        const a0 = 1 + alpha;
        return { b0: alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0, g };
      });
    }
    const x = src[i];
    let y = 0;
    for (let k = 0; k < nF; k++) {
      const c = coefs[k];
      const s = state[k];
      const v = c.b0 * x - c.b0 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
      s.x2 = s.x1;
      s.x1 = x;
      s.y2 = s.y1;
      s.y1 = v;
      y += v * c.g;
    }
    out[i] = y;
  }
  return out;
}

export type FilterType = "lowpass" | "highpass" | "bandpass" | "peak";

/** مرشح biquad متغير مع الزمن (معادلات RBJ) */
export function filter(x: Float32Array, type: FilterType, freq: Curve, q: Curve = 0.707, gainDb: Curve = 0, block = 32): Float32Array {
  const out = new Float32Array(x.length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a1 = 0;
  let a2 = 0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % block === 0) {
      const t = i / SR;
      const f = Math.min(atLog(freq, t), SR * 0.45);
      const Q = at(q, t);
      const w = (2 * Math.PI * f) / SR;
      const cw = Math.cos(w);
      const alpha = Math.sin(w) / (2 * Q);
      let a0: number;
      if (type === "lowpass") {
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = (1 - cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
      } else if (type === "highpass") {
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = (1 + cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
      } else if (type === "bandpass") {
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
      } else {
        const A = 10 ** (at(gainDb, t) / 40);
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
      }
      b0 /= a0;
      b1 /= a0;
      b2 /= a0;
      a1 /= a0;
      a2 /= a0;
    }
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

export function drive(x: Float32Array, amount: number): Float32Array {
  const out = new Float32Array(x.length);
  const norm = Math.tanh(amount);
  for (let i = 0; i < x.length; i++) out[i] = Math.tanh(x[i] * amount) / norm;
  return out;
}

/** تعديل السعة (ترمولو/رفرفة) */
export function am(x: Float32Array, rate: Curve, depth: Curve, shape: "sine" | "pulse" = "sine"): Float32Array {
  const out = new Float32Array(x.length);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const d = at(depth, t);
    const m = shape === "sine" ? 0.5 + 0.5 * Math.sin(2 * Math.PI * phase) : phase < 0.35 ? 1 : 0;
    out[i] = x[i] * (1 - d + d * m);
    phase += at(rate, t) / SR;
    phase -= Math.floor(phase);
  }
  return out;
}

export function add(...parts: Float32Array[]): Float32Array {
  const n = Math.max(...parts.map((p) => p.length));
  const out = new Float32Array(n);
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

export function scale(x: Float32Array, g: number): Float32Array {
  return x.map((v) => v * g);
}

/** يضع مقاطع على خط زمني: [وقت البداية بالثواني، المقطع، الكسب] */
export function timeline(total: number, items: [number, Float32Array, number?][]): Float32Array {
  const out = new Float32Array(len(total));
  for (const [t0, buf, g = 1] of items) {
    const s = Math.round(t0 * SR);
    for (let i = 0; i < buf.length && s + i < out.length; i++) if (s + i >= 0) out[s + i] += buf[i] * g;
  }
  return out;
}

/** صدى غرفة بسيط (Schroeder) */
export function reverb(x: Float32Array, wet = 0.2, room = 0.75, tail = 0.8): Float32Array {
  const out = new Float32Array(x.length + len(tail));
  const combs = [1116, 1188, 1277, 1356].map((d) => ({ d: Math.round(d / 2), buf: new Float32Array(Math.round(d / 2)), i: 0, lp: 0 }));
  const aps = [556, 441].map((d) => ({ d: Math.round(d / 2), buf: new Float32Array(Math.round(d / 2)), i: 0 }));
  const fb = 0.7 + 0.28 * room;
  for (let n = 0; n < out.length; n++) {
    const input = n < x.length ? x[n] : 0;
    let s = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp = y * 0.6 + c.lp * 0.4;
      c.buf[c.i] = input + c.lp * fb;
      c.i = (c.i + 1) % c.d;
      s += y;
    }
    s *= 0.25;
    for (const a of aps) {
      const b = a.buf[a.i];
      const y = -s + b;
      a.buf[a.i] = s + b * 0.5;
      a.i = (a.i + 1) % a.d;
      s = y;
    }
    out[n] = input * (1 - wet) + s * wet * 1.6;
  }
  return out;
}

/** تطبيع القمة إلى -1dBFS مع تلاشٍ بسيط في الطرفين وهامش صامت قصير */
export function finish(x: Float32Array, leadSec = 0.05, tailSec = 0.12, peakDb = -1): Float32Array {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 10 ** (peakDb / 20) / peak : 1;
  const lead = len(leadSec);
  const out = new Float32Array(lead + x.length + len(tailSec));
  const fadeIn = len(0.004);
  const fadeOut = len(0.02);
  for (let i = 0; i < x.length; i++) {
    let v = x[i] * g;
    if (i < fadeIn) v *= i / fadeIn;
    if (i > x.length - fadeOut) v *= (x.length - i) / fadeOut;
    out[lead + i] = v;
  }
  return out;
}

/** صوت بشري/حيواني جاهز: مصدر حنجري + حروف متحركة + غلاف */
export function voiced(dur: number, f0: Curve, vowelSeq: [number, string][], opts: VoiceOpts & { scale?: number; env?: Pts } = {}): Float32Array {
  const src = voiceSource(dur, f0, opts);
  const shaped = formantFilter(src, vowels(vowelSeq, opts.scale ?? 1));
  const e = opts.env ?? [
    [0, 0],
    [Math.min(0.03, dur * 0.2), 1],
    [dur * 0.8, 0.85],
    [dur, 0],
  ];
  return applyEnv(shaped, e);
}

/** دفقة ضجيج مرشّحة بغلاف (احتكاك، نفَس، فحيح) */
export function burst(dur: number, type: FilterType, freq: Curve, q: Curve, env: Pts, seed = 3, color: "white" | "pink" | "brown" = "white"): Float32Array {
  return applyEnv(filter(noise(dur, color, seed), type, freq, q), env);
}
