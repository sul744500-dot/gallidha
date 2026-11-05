// معايرة «الكلمات لا الهمهمة» على مكتبة الترندات:
//   ممتاز  = نفس أداء المقطع بحنجرة أخرى (تغيير طبقة) وميكروفون آخر — الحد الأعلى
//   كلمات  = الكلمات الصحيحة منطوقة (Piper عادي/بطيء + أصوات Windows إنجليزية بلكنة: متحدث آخر تمامًا)
//   همهمة  = «ممم» رجل/امرأة، «أممم» رجل/امرأة، «آآآ» — كلها على نفس لحن المقطع وإيقاعه بالضبط
//   غلط    = كلام آخر
//   npx tsx scripts/calibrate-words.ts        (DEBUG_ID=algum للتفاصيل)
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeWav } from "../shared/audio/wav";
import { resample } from "../shared/audio/resample";
import { extractFeatures } from "../shared/audio/features";
import { compareFeatures } from "../shared/audio/score";
import { imitate, impersonate } from "../shared/audio/imitate";
import { SAMPLE_RATE } from "../shared/constants";

const root = fileURLToPath(new URL("..", import.meta.url));
const PACK = resolve(root, process.env.PACK ?? "public/packs/trends");
const WORDS = resolve(root, "tests/fixtures/words");
const load16 = (file: string) => {
  const d = decodeWav(readFileSync(file));
  return resample(d.samples, d.sampleRate, SAMPLE_RATE);
};
const manifest = JSON.parse(readFileSync(join(PACK, "pack.json"), "utf8")) as { sounds: { id: string; file: string; template?: string; articulate?: boolean }[] };
const fixtures = (id: string) => [`${id}.wav`, `${id}-slow.wav`, `${id}.david.wav`, `${id}.zira-slow.wav`].map((f) => join(WORDS, f)).filter(existsSync);
const others = ["other-1.wav", "other-2.wav", "other-3.wav", "wrong-1.david.wav", "wrong-2.zira.wav"].map((f) => load16(join(WORDS, f)));
type Row = { kind: string; score: number | null; status: string; words?: number; melody?: number };
const all: Record<string, number[]> = {};
const KINDS = ["perfect", "words", "hum", "wrong"] as const;
console.log("الصوت".padEnd(16), "ممتاز".padEnd(22), "كلمات صحيحة".padEnd(34), "همهمة ممم×2 أممم×2 آآآ".padEnd(40), "كلام غلط");
for (const s of manifest.sounds) {
  const refRaw = load16(join(PACK, s.file));
  const ref = extractFeatures(refRaw, SAMPLE_RATE);
  const words = s.articulate === false ? false : s.template ? extractFeatures(load16(join(PACK, s.template)), SAMPLE_RATE) : true;
  const rows: Row[] = [];
  const run = (kind: string, x: Float32Array) => {
    const r = compareFeatures(ref, extractFeatures(x, SAMPLE_RATE), { words });
    rows.push({ kind, score: r.score, status: r.status, words: r.parts?.words, melody: r.debug?.melody });
    (all[kind] ??= []).push(r.score ?? 0);
  };
  run("perfect", impersonate(refRaw, 3, 1));
  run("perfect", impersonate(refRaw, -4, 2));
  for (const f of fixtures(s.id)) run("words", load16(f));
  run("hum", imitate(refRaw, SAMPLE_RATE, { hum: true, vowel: [270, 1050, 2250], range: [90, 200], sloppiness: 0.1, seed: 1 }));
  run("hum", imitate(refRaw, SAMPLE_RATE, { hum: true, vowel: [300, 1150, 2400], range: [180, 400], sloppiness: 0.1, seed: 2 }));
  run("hum", imitate(refRaw, SAMPLE_RATE, { hum: "umm", vowel: [270, 1050, 2250], range: [90, 200], sloppiness: 0.1, seed: 3 }));
  run("hum", imitate(refRaw, SAMPLE_RATE, { hum: "umm", vowel: [300, 1150, 2400], range: [180, 400], sloppiness: 0.1, seed: 4 }));
  run("hum", imitate(refRaw, SAMPLE_RATE, { hum: true, vowel: [700, 1150, 2450], sloppiness: 0.1, seed: 5 }));
  for (const o of others) run("wrong", o);
  const fmt = (k: string) =>
    rows
      .filter((r) => r.kind === k)
      .map((r) => (r.status === "ok" ? `${String(r.score).padStart(2)}(${String(r.words).padStart(3)})` : r.status.slice(0, 7).padStart(7)))
      .join(" ");
  console.log(`${s.id}${s.template ? "*" : ""}`.padEnd(16), fmt("perfect").padEnd(22), fmt("words").padEnd(34), fmt("hum").padEnd(40), fmt("wrong"));
  if (process.env.DEBUG_ID && s.id.includes(process.env.DEBUG_ID)) for (const r of rows) console.log("   ", JSON.stringify(r));
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log("\n* = له قالب كلمات.  الدرجة(الكلمات)");
console.log("الوسيط:", KINDS.filter((k) => all[k]).map((k) => `${k}=${med(all[k])} (أعلى ${Math.max(...all[k])}، أقل ${Math.min(...all[k])})`).join("  |  "));
