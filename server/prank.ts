// مقلب صاحب اللعبة (بطلبه): أي لاعب اسمه «عبدالرحمن» — بأي كتابة، أو بلقبه «دحوم» —
// تطلع درجة تقليده منخفضة جدًا (1–5) مهما كان أداؤه، والمعايير منخفضة معها حتى تبدو طبيعية.
// يُطبَّق على الخادم فقط (في الجولات والتدريب الفردي)، ولا يمس حالات «غير موثوق» (صامت، مكتوم…).

import type { ScoreParts, ScoreResult } from "../shared/types";

const ARABIC_TARGETS = ["عبدالرحمن", "عبدالرحمان", "دحوم"];
// Abdulrahman / Abdelrahman / Abdurrahman / Abd El-Rahman / 3bdulrahman / Dahoom
const LATIN_TARGET = /(?:a|3|e)bd[aeiou]?l?[aeiou]?r+[aeiou]?h?m[aeiou]+n|dah+o+m|da7o+m|d7o+m/;

/** توحيد الكتابة: بلا تشكيل ولا تطويل ولا مسافات ولا رموز، والألف بأشكالها ألف */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^a-z0-9ء-ي]/g, "");
}

export function isPrankTarget(name: string): boolean {
  const n = normalizeName(name);
  return ARABIC_TARGETS.some((t) => n.includes(t)) || LATIN_TARGET.test(n);
}

export function prankScore(name: string, r: ScoreResult, random: () => number = Math.random): ScoreResult {
  if (r.status !== "ok" || r.score === null || !r.parts || !isPrankTarget(name)) return r;
  const parts = Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, Math.min(v ?? 0, Math.floor(random() * 12))])) as unknown as ScoreParts;
  return { ...r, score: 1 + Math.floor(random() * 5), parts };
}
