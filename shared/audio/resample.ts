// تحويل معدل العينات بمرشح sinc مُنَوفَذ (جودة عالية بدون تشويه طيفي)
// يُستخدم في المتصفح (48 كيلو ← 16 كيلو للتسجيل) وفي الخادم (أصوات المكتبة ← 16 كيلو للتحليل)

const ZERO_CROSSINGS = 10;
const TABLE_RES = 256;

function blackman(x: number): number {
  // x في [0, 1]
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
}

const tables = new Map<number, Float32Array>();

/** جدول نواة المرشح لقيم |x| من 0 إلى support بدقة 1/256 عينة (يتجنب حساب sin لكل عينة) */
function kernelTable(cutoff: number, support: number): Float32Array {
  const key = Math.round(cutoff * 1e6);
  let t = tables.get(key);
  if (t) return t;
  const len = Math.ceil(support * TABLE_RES) + 2;
  t = new Float32Array(len);
  for (let k = 0; k < len; k++) {
    const x = k / TABLE_RES;
    if (x >= support) {
      t[k] = 0;
      continue;
    }
    const px = Math.PI * x * cutoff;
    const sinc = px === 0 ? 1 : Math.sin(px) / px;
    t[k] = sinc * blackman((x / support + 1) / 2);
  }
  if (tables.size > 16) tables.clear();
  tables.set(key, t);
  return t;
}

export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  if (input.length === 0) return new Float32Array(0);
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  // عند التخفيض نقص النطاق تحت تردد نايكوِست الجديد
  const cutoff = Math.min(1, ratio) * 0.95;
  const support = ZERO_CROSSINGS / cutoff; // بعدد عينات الإدخال
  const table = kernelTable(cutoff, support);
  const tmax = table.length - 2;
  const n = input.length;
  for (let i = 0; i < outLen; i++) {
    const center = i / ratio;
    const start = Math.max(0, Math.ceil(center - support));
    const end = Math.min(n - 1, Math.floor(center + support));
    let acc = 0;
    let wsum = 0;
    for (let j = start; j <= end; j++) {
      let pos = (j - center) * TABLE_RES;
      if (pos < 0) pos = -pos;
      const k = pos | 0;
      if (k >= tmax) continue;
      const f = pos - k;
      const w = table[k] + (table[k + 1] - table[k]) * f;
      acc += input[j] * w;
      wsum += w;
    }
    out[i] = wsum !== 0 ? acc / wsum : 0;
  }
  return out;
}
