import { describe, expect, it } from "vitest";
import { isPrankTarget, prankScore } from "../server/prank";
import type { ScoreResult } from "../shared/types";

describe("مقلب «عبدالرحمن»", () => {
  it("يعرف الاسم بكل كتاباته ولقبه", () => {
    for (const n of ["عبدالرحمن", "عبد الرحمن", "عبدُالرَّحمٰن", "عبدالرحمان", "أبو عبدالرحمن 😎", "دحوم", "دحومي", "Abdulrahman", "Abd El-Rahman", "abdurrahman", "3bdulrahman", "Dahoom"]) {
      expect(isPrankTarget(n), n).toBe(true);
    }
  });

  it("ما يمس باقي الأسماء", () => {
    for (const n of ["سارة", "فهد", "عبدالله", "عبدالعزيز", "رحمة", "حمودي", "Abdullah", "Rahma", "Abdulaziz"]) {
      expect(isPrankTarget(n), n).toBe(false);
    }
  });

  it("الدرجة تصير 1–5 والمعايير منخفضة، وحالات «غير موثوق» تبقى كما هي", () => {
    const ok: ScoreResult = { status: "ok", score: 93, parts: { pitch: 96, rhythm: 72, timing: 96, energy: 100, spectral: 80, words: 100 } };
    for (let i = 0; i < 50; i++) {
      const r = prankScore("عبدالرحمن", ok);
      expect(r.score!).toBeGreaterThanOrEqual(1);
      expect(r.score!).toBeLessThanOrEqual(5);
      for (const v of Object.values(r.parts!)) expect(v).toBeLessThan(12);
    }
    expect(prankScore("سارة", ok)).toBe(ok);
    const silent: ScoreResult = { status: "silent", score: null, parts: null };
    expect(prankScore("عبدالرحمن", silent)).toBe(silent);
  });
});
