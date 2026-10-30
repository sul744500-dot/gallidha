// معايرة التقييم: يقارن كل صوت مرجعي بتقليدات صناعية (متقن، صوت عميق/حاد، غير متقن، صوت آخر)
// ويطبع التشابه الخام لكل معيار لاختيار حدود المعايرة في shared/audio/score.ts
//   npm run calibrate

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeWav } from "../shared/audio/wav";
import { extractFeatures } from "../shared/audio/features";
import { compareFeatures } from "../shared/audio/score";
import { imitate } from "../shared/audio/imitate";
import { resample } from "../shared/audio/resample";
import { SAMPLE_RATE } from "../shared/constants";
import type { ScoreParts } from "../shared/types";

const root = fileURLToPath(new URL("..", import.meta.url));
const packsDir = resolve(root, "public/packs");

interface Ref {
  id: string;
  samples: Float32Array;
  rate: number;
  weights?: Partial<ScoreParts>;
}
const refs: Ref[] = [];
for (const pack of readdirSync(packsDir)) {
  const manifest = JSON.parse(readFileSync(join(packsDir, pack, "pack.json"), "utf8"));
  for (const s of manifest.sounds) {
    const d = decodeWav(readFileSync(join(packsDir, pack, s.file)));
    refs.push({ id: `${pack}/${s.id}`, samples: d.samples, rate: d.sampleRate, weights: s.weights });
  }
}

const feats = new Map(refs.map((r) => [r.id, extractFeatures(r.samples, r.rate)]));
type Case = "good" | "deep" | "high" | "sloppy" | "wrong";
const rows: Record<Case, { id: string; score: number | null; status: string; sims: Record<string, number> }[]> = {
  good: [],
  deep: [],
  high: [],
  sloppy: [],
  wrong: [],
};

refs.forEach((ref, i) => {
  const refF = feats.get(ref.id)!;
  const variants: [Case, Float32Array][] = [
    ["good", imitate(ref.samples, ref.rate, { sloppiness: 0.15, seed: i + 1 })],
    ["deep", imitate(ref.samples, ref.rate, { sloppiness: 0.15, pitchFactor: 0.5, range: [75, 200], vowel: [600, 1000, 2300], seed: i + 2 })],
    ["high", imitate(ref.samples, ref.rate, { sloppiness: 0.15, pitchFactor: 1.7, range: [230, 750], vowel: [850, 1500, 2900], seed: i + 3 })],
    ["sloppy", imitate(ref.samples, ref.rate, { sloppiness: 0.7, timeStretch: 1.35, flatten: 0.5, seed: i + 4 })],
  ];
  const other = refs[(i + 7) % refs.length];
  variants.push(["wrong", imitate(other.samples, other.rate, { sloppiness: 0.15, seed: i + 5 })]);
  for (const [kind, x] of variants) {
    const res = compareFeatures(refF, extractFeatures(x, SAMPLE_RATE), { weights: ref.weights });
    const sims = Object.fromEntries(Object.entries(res.debug ?? {}).filter(([k]) => k.startsWith("sim_")).map(([k, v]) => [k.slice(4), v]));
    rows[kind].push({ id: ref.id, score: res.score, status: res.status, sims });
    if (process.env.DEBUG_ID && ref.id.includes(process.env.DEBUG_ID)) console.log(kind, res.score, JSON.stringify(Object.fromEntries(Object.entries(res.debug ?? {}).map(([k, v]) => [k, +Number(v).toFixed(3)]))));
  }
});

const parts = ["pitch", "rhythm", "timing", "energy", "spectral"];
const pct = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};
console.log("\nالتشابه الخام لكل معيار (p20 / p50 / p80):");
for (const kind of Object.keys(rows) as Case[]) {
  const line = parts
    .map((p) => {
      const v = rows[kind].filter((r) => r.status === "ok").map((r) => r.sims[p]);
      return `${p}=${pct(v, 20).toFixed(2)}/${pct(v, 50).toFixed(2)}/${pct(v, 80).toFixed(2)}`;
    })
    .join("  ");
  const scores = rows[kind].map((r) => r.score ?? -1);
  console.log(`${kind.padEnd(7)} score p20/p50/p80 = ${pct(scores, 20)}/${pct(scores, 50)}/${pct(scores, 80)}  | ${line}`);
}
console.log("\nلكل صوت: متقن / عميق / حاد / غير متقن / صوت آخر");
refs.forEach((ref, i) => {
  const s = (k: Case) => {
    const r = rows[k][i];
    return r.status === "ok" ? String(r.score).padStart(3) : r.status.slice(0, 3);
  };
  console.log(`${ref.id.padEnd(22)} ${s("good")} ${s("deep")} ${s("high")} ${s("sloppy")} ${s("wrong")}`);
});

// اختبارات حالات خاصة
const r0 = refs[0];
const f0 = feats.get(r0.id)!;
const exact = compareFeatures(f0, extractFeatures(resample(r0.samples, r0.rate, SAMPLE_RATE), SAMPLE_RATE));
console.log(`\nتشغيل الملف الأصلي نفسه: ${exact.status} (replay=${exact.debug?.replay?.toFixed(3)})`);
const silent = compareFeatures(f0, extractFeatures(new Float32Array(SAMPLE_RATE * 3), SAMPLE_RATE));
console.log(`تسجيل صامت: ${silent.status}`);
