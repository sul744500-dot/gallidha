import { describe, expect, it } from "vitest";
import { isRude, RUDE_LISTS } from "../server/moderation";

// الأمثلة الممنوعة تُقرأ من القائمة المرمّزة نفسها حتى لا تظهر الألفاظ صريحة في ملفات الاختبار
const arabic = (w: string) => /[ء-ي]/.test(w);

describe("فلتر الأسماء غير اللائقة", () => {
  it("يمنع كل كلمة في القائمة، ولو كانت ممطوطة أو مع «يا/ال» أو داخل اسم أطول", () => {
    for (const w of [...RUDE_LISTS.anywhere, ...RUDE_LISTS.word]) {
      expect(isRude(w), w).toBe(true);
      expect(isRude(` ${w.toUpperCase()} `), w).toBe(true);
      expect(isRude(w.replace(/(.)$/, "$1$1$1")), `${w} ممطوطة`).toBe(true);
      if (arabic(w)) {
        expect(isRude(`يا ${w}`), `يا ${w}`).toBe(true);
        expect(isRude(`ال${w}`), `ال${w}`).toBe(true);
        expect(isRude(`أبو فهد ${w}`), `داخل اسم: ${w}`).toBe(true);
      }
    }
    for (const w of RUDE_LISTS.anywhere) expect(isRude(`xx${w}xx`), `${w} وسط كلمة`).toBe(true);
  });

  it("ما يظلم الأسماء البريئة اللي فيها حروف مشابهة", () => {
    const fine = [
      "سارة", "فهد", "نورة", "عبدالرحمن", "تيسير", "كسرى", "مكسيك", "زبيدة", "خرائط", "حيوانات", "طيبة", "مونيكا", "عرفات", "نايف", "أبو فهد", "غرفة الشباب", "ملك الميمز",
      "Hassan", "Cassandra", "Dickson", "Sussex", "Hitchcock", "Glasgow", "Basel", "Assem", "Kosta", "Zebra", "Tease", "Kalbani", "Sam", "Bruh Boy",
    ];
    for (const n of fine) expect(isRude(n), n).toBe(false);
  });
});
