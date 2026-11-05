// فلتر الأسماء: يرفض اسم اللاعب أو الغرفة إذا فيه سب أو كلام وسخ أو إساءة (عربي، إنجليزي، عربيزي).
// قائمة الكلمات مرمّزة Base64 حتى لا تظهر الألفاظ صريحة في الكود المنشور؛ لتعديلها:
//   node -e "console.log(Buffer.from(process.argv[1],'base64').toString())" <النص>   ← فك
//   ثم أعد ترميز JSON بنفس الشكل { anywhere: [...], word: [...] }
//   anywhere = ممنوعة في أي مكان من الاسم (كلمات طويلة مميزة)
//   word     = ممنوعة كاسم/كلمة كاملة فقط (كلمات قصيرة قد تكون جزءًا من كلمة بريئة)

const ENCODED = "eyJhbnl3aGVyZSI6WyLYtNix2YXZiNi3Iiwi2LTYsdmF2LfZhyIsItmC2K3YqNmHIiwi2YXZhtmK2YjZgyIsItmF2KrZhtin2YMiLCLZhtmK2KfZgyIsItin2YbZitmD2YMiLCLZitmG2YrZgyIsItmG2YrZg9mG2YoiLCLZg9iz2YXZgyIsItmD2LPYp9mF2YMiLCLZg9iz2K7YqtmDIiwi2YPYs9in2K7YqtmDIiwi2K/ZitmI2KsiLCLZhdi52LHYtSIsItmE2YjYt9mKIiwi2LLYp9mG2YrZhyIsIti52KfZh9ix2YciLCLZitmE2LnZhiIsItmF2K7ZhtirIiwi2K7ZhtmK2KsiLCLYt9mK2LLZgyIsItiy2KjZgyIsImZ1Y2siLCJmY2siLCJmdWsiLCJzaGl0IiwiYml0Y2giLCJidGNoIiwiY3VudCIsIndob3JlIiwic2x1dCIsIm5pZ2ciLCJmYWdnb3QiLCJtb3RoZXJmIiwiYXNzaG9sZSIsInB1c3N5IiwicmV0YXJkIiwicG9ybiIsImRpY2toZWFkIiwiYmFzdGFyZCIsIndhbmtlciIsInR3YXQiLCJob3JueSIsImJvb2IiLCJzaGFybW9vdCIsInNoYXJtb3QiLCJnYWhiYSIsImthaGJhIiwiOWE3YmEiLCIyYTdiYSIsImtvc29tYWsiLCJrb3NvbWsiLCJrb3NvbW1hayIsIm1hbnlvayIsIm1hbnlhayIsInplYmkiLCJ0ZWV6YWsiLCJ5ZWwzYW4iLCJ5bDNuIl0sIndvcmQiOlsi2YPYsyIsItiy2KgiLCLYt9mK2LIiLCLZhtmK2YMiLCLZg9mE2KgiLCLZg9mE2KjZhyIsItmD2YTYp9ioIiwi2K3Zhdin2LEiLCLYrdmF2KfYsdmHIiwi2K3ZhdmK2LEiLCLYqtmK2LMiLCLYrtmG2LLZitixIiwi2K7Zhtiy2YrYsdmHIiwi2K7Zhtin2LLZitixIiwi2K3ZitmI2KfZhiIsItit2YrZiNin2YbZhyIsIti62KjZiiIsIti62KjZitmHIiwi2KfYutio2YoiLCLYrdmC2YrYsSIsItit2YLZitix2YciLCLZiNiz2K4iLCLZiNiz2K7ZhyIsItmI2LXYriIsItmI2LXYrtmHIiwi2LLZgiIsItiu2LHYpyIsItiu2LHZhyIsItiu2LHZiiIsItiy2KjYp9mE2YciLCLZh9i32YEiLCLYrdmC2YjYryIsItin2YfYqNmEIiwi2YfYqNmE2YciLCLZhdi52KfZgiIsItmF2LnYp9mC2YciLCLYrtmI2YQiLCLZgtit2KgiLCLYudix2LUiLCLZgtmI2KfYryIsItmF2YTYudmI2YYiLCLZhdmE2LnZiNmG2YciLCLYrNit2LQiLCLYudin2YfYsSIsItmB2KfYrNixIiwi2YHYp9is2LHZhyIsItiz2KfZgdmEIiwi2LPYp9mB2YTZhyIsItmF2YbYrdi3Iiwi2YbYsNmEIiwi2YjYp9i32YoiLCLYrdir2KfZhNmHIiwi2YXZhtmK2YMiLCLZhdmG2YrZg9mHIiwiYXNzIiwiZGljayIsImNvY2siLCJzZXgiLCJzZXh5IiwibmF6aSIsImhpdGxlciIsImtvcyIsInplYiIsInRlZXoiLCJrYWxiIiwiN21hciIsIjVhcmEiLCJraGFyYSIsInpiYWxhIiwiN2F5d2FuIiwiZ2hhYmkiLCI3YXFlZXIiLCJ3YXNlNSIsIm5lZWsiXX0=";

/** توحيد الكتابة: بلا تشكيل ولا تطويل، والألف بأشكالها ألف، والتاء المربوطة هاء */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^a-z0-9ء-ي]/g, "");
}
/** الحروف المكررة للتحايل على الفلتر تُختصر: «سسسلام» = «سلام» */
const squeeze = (s: string) => s.replace(/(.)\1+/g, "$1");
/** نفس الفكرة مع إبقاء الحرف المضاعف أصلًا: «assss» = «ass» */
const squeeze2 = (s: string) => s.replace(/(.)\1{2,}/g, "$1$1");
const variants = (w: string) => [w, squeeze2(w), squeeze(w)].filter((x) => x.length >= 2);

const lists = JSON.parse(Buffer.from(ENCODED, "base64").toString("utf8")) as { anywhere: string[]; word: string[] };
/** للاختبارات فقط */
export const RUDE_LISTS: Readonly<typeof lists> = lists;
const ANYWHERE = [...new Set(lists.anywhere.flatMap((w) => variants(norm(w))))].filter((w) => w.length >= 3);
const WORDS = new Set(lists.word.flatMap((w) => [norm(w), squeeze2(norm(w)), ...(squeeze(norm(w)).length >= 3 ? [squeeze(norm(w))] : [])]));

function badToken(t: string): boolean {
  const forms = new Set(variants(t));
  for (const f of [...forms]) {
    // «ياكلب»، «الكلب»، «يالكلب» ← كلب
    for (const p of ["يال", "يا", "ال"]) if (f.startsWith(p) && f.length - p.length >= 2) forms.add(f.slice(p.length));
  }
  for (const f of [...forms]) {
    // «طيزك»، «زبي»، «كلبه» ← الجذع
    for (const s of ["ك", "ي", "ه"]) if (f.endsWith(s) && f.length - s.length >= 2) forms.add(f.slice(0, -s.length));
  }
  for (const f of forms) if (WORDS.has(f)) return true;
  return false;
}

export function isRude(text: string): boolean {
  if (!text) return false;
  const forms = variants(norm(text));
  if (ANYWHERE.some((w) => forms.some((f) => f.includes(w)))) return true;
  return text
    .split(/[\s\-_.,،!؟?*+/\\|()[\]{}"'«»:;~^=<>@#$%&]+/)
    .map(norm)
    .filter(Boolean)
    .some(badToken);
}
