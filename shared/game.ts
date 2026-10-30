// قواعد اللعب المشتركة: الإعدادات الافتراضية والتحقق منها، شرائح عجلة الحظ، مدد المراحل

import { MAX_PLAYERS, MIN_PLAYERS, RECORD_CHOICES, ROUND_CHOICES } from "./constants";
import type { Category, GameMode, RoomSettings, WheelOutcome } from "./types";

export const CATEGORIES: Category[] = ["animals", "machines", "human", "hard", "saudi"];
export const MODES: GameMode[] = ["classic", "laugh", "hard", "saudi"];

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  rounds: 6,
  recordSeconds: "auto",
  categories: ["animals", "machines", "human", "saudi"],
  mode: "classic",
  wheel: true,
  voiceChat: true,
  revealOrder: "random",
};

/** يدمج تعديلًا (من العميل) مع إعدادات صالحة، متجاهلًا أي قيمة غير مسموحة */
export function sanitizeSettings(patch: unknown, base: RoomSettings = DEFAULT_SETTINGS): RoomSettings {
  const s: RoomSettings = { ...base, categories: [...base.categories] };
  if (!patch || typeof patch !== "object") return s;
  const p = patch as Record<string, unknown>;
  if (typeof p.maxPlayers === "number" && Number.isInteger(p.maxPlayers))
    s.maxPlayers = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, p.maxPlayers));
  if ((ROUND_CHOICES as readonly unknown[]).includes(p.rounds)) s.rounds = p.rounds as RoomSettings["rounds"];
  if ((RECORD_CHOICES as readonly unknown[]).includes(p.recordSeconds)) s.recordSeconds = p.recordSeconds as RoomSettings["recordSeconds"];
  if (Array.isArray(p.categories)) {
    const cats = CATEGORIES.filter((c) => (p.categories as unknown[]).includes(c));
    if (cats.length) s.categories = cats;
  }
  if (MODES.includes(p.mode as GameMode)) s.mode = p.mode as GameMode;
  if (typeof p.wheel === "boolean") s.wheel = p.wheel;
  if (typeof p.voiceChat === "boolean") s.voiceChat = p.voiceChat;
  if (p.revealOrder === "random" || p.revealOrder === "fixed") s.revealOrder = p.revealOrder;
  return s;
}

/**
 * شرائح العجلة كما تظهر للاعبين: كل شريحة بنفس الحجم، فالاحتمال = عدد تكرار النتيجة / عدد الشرائح.
 * (ما تشوفه هو الاحتمال الحقيقي)
 */
export const WHEEL_SLICES: WheelOutcome[] = [
  "plus20",
  "sabotage",
  "double",
  "steal",
  "plus50",
  "shield",
  "plus20",
  "sabotage",
  "swap",
  "shield",
  "steal",
  "double",
];

export const TARGETED: WheelOutcome[] = ["steal", "swap", "sabotage"];
export const STEAL_AMOUNT = 20;

export function wheelNeedsTarget(o: WheelOutcome): boolean {
  return TARGETED.includes(o);
}

/** مدة نافذة التسجيل حسب طول الصوت المرجعي والإعدادات */
export function recordWindowMs(settings: RoomSettings, refMs: number): number {
  if (settings.recordSeconds !== "auto") return settings.recordSeconds * 1000;
  if (settings.mode === "hard") return Math.round(Math.min(8000, Math.max(2500, refMs * 1.15 + 600)));
  return Math.round(Math.min(9000, Math.max(3000, refMs * 1.3 + 1000)));
}

export function isValidCode(code: unknown): code is string {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

export function cleanName(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  // إزالة محارف التحكم والاتجاه المخفية
  const s = raw
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return [...s].slice(0, max).join("");
}
