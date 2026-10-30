// أدوات معالجة إشارة أساسية: FFT، نوافذ، بنك مرشحات ميل، DCT

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function plan(n: number) {
  let p = twiddleCache.get(n);
  if (p) return p;
  if (n & (n - 1)) throw new Error("FFT size must be a power of two");
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  p = { cos, sin, rev };
  twiddleCache.set(n, p);
  return p;
}

/** FFT مركّب في المكان (radix-2) */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, rev } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>();
export function hann(n: number): Float64Array {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return w;
}

export const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
export const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

/** بنك مرشحات مثلثية على مقياس ميل: [band][bin] كقائمة (start, weights) لتسريع الحساب */
export interface MelBank {
  bands: { start: number; weights: Float64Array }[];
}

const melCache = new Map<string, MelBank>();
export function melBank(nfft: number, sr: number, nMels: number, fmin: number, fmax: number): MelBank {
  const key = `${nfft}:${sr}:${nMels}:${fmin}:${fmax}`;
  let bank = melCache.get(key);
  if (bank) return bank;
  const nBins = nfft / 2 + 1;
  const mMin = hzToMel(fmin);
  const mMax = hzToMel(fmax);
  const points: number[] = [];
  for (let i = 0; i < nMels + 2; i++) points.push(melToHz(mMin + ((mMax - mMin) * i) / (nMels + 1)));
  const binHz = sr / nfft;
  const bands: MelBank["bands"] = [];
  for (let m = 0; m < nMels; m++) {
    const lo = points[m];
    const mid = points[m + 1];
    const hi = points[m + 2];
    const start = Math.max(0, Math.floor(lo / binHz));
    const end = Math.min(nBins - 1, Math.ceil(hi / binHz));
    const weights = new Float64Array(end - start + 1);
    for (let b = start; b <= end; b++) {
      const f = b * binHz;
      let w = 0;
      if (f > lo && f <= mid) w = (f - lo) / (mid - lo);
      else if (f > mid && f < hi) w = (hi - f) / (hi - mid);
      weights[b - start] = w;
    }
    bands.push({ start, weights });
  }
  bank = { bands };
  melCache.set(key, bank);
  return bank;
}

const dctCache = new Map<string, Float64Array[]>();
/** مصفوفة DCT-II (معامِلات × مدخلات) */
export function dctMatrix(nIn: number, nOut: number): Float64Array[] {
  const key = `${nIn}:${nOut}`;
  let m = dctCache.get(key);
  if (m) return m;
  m = [];
  for (let k = 0; k < nOut; k++) {
    const row = new Float64Array(nIn);
    for (let n = 0; n < nIn; n++) row[n] = Math.cos((Math.PI * k * (n + 0.5)) / nIn) * Math.sqrt(2 / nIn);
    m.push(row);
  }
  dctCache.set(key, m);
  return m;
}

export function mean(a: ArrayLike<number>, from = 0, to = a.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return to > from ? s / (to - from) : 0;
}

export function std(a: ArrayLike<number>, from = 0, to = a.length): number {
  const m = mean(a, from, to);
  let s = 0;
  for (let i = from; i < to; i++) s += (a[i] - m) ** 2;
  return to > from ? Math.sqrt(s / (to - from)) : 0;
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const arr = Array.from(values).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round((p / 100) * (arr.length - 1))));
  return arr[idx];
}

export function median(values: number[]): number {
  return percentile(values, 50);
}

/** معامل ارتباط بيرسون */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da < 1e-12 || db < 1e-12) return 0;
  return num / Math.sqrt(da * db);
}

/** إعادة أخذ عينات منحنى بطول جديد بالاستيفاء الخطي (لتطبيع الزمن) */
export function stretch(src: ArrayLike<number>, len: number): Float64Array {
  const out = new Float64Array(len);
  const n = src.length;
  if (n === 0) return out;
  if (n === 1) {
    out.fill(src[0]);
    return out;
  }
  for (let i = 0; i < len; i++) {
    const pos = (i * (n - 1)) / Math.max(1, len - 1);
    const k = Math.floor(pos);
    const f = pos - k;
    out[i] = k + 1 < n ? src[k] * (1 - f) + src[k + 1] * f : src[n - 1];
  }
  return out;
}

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** مولّد أرقام عشوائية حتمي (mulberry32) للمؤثرات والاختبارات */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
