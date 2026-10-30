// ثوابت مشتركة بين الخادم والمتصفح

/** معدل عينات تسجيلات اللاعبين وكل التحليل الصوتي (أحادي القناة، 16 بت) */
export const SAMPLE_RATE = 16000;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const ROUND_CHOICES = [4, 6, 8, 10] as const;
export const RECORD_CHOICES = ["auto", 4, 6, 8] as const;
export const NAME_MAX = 16;
export const ROOM_NAME_MAX = 24;
export const CODE_LENGTH = 6;
export const REPORT_MAX = 200;

/** أقصى حجم لتسجيل واحد: 10 ثوانٍ × 16000 × 2 بايت + هامش */
export const MAX_RECORDING_BYTES = 360_000;
/** أطول مدة تسجيل يقبلها الخادم بعد إضافة الهامش */
export const MAX_RECORD_MS = 10_000;

/** نقاط كل صوت في وضع الضحك */
export const VOTE_POINTS = 20;

/** ألوان الشخصيات (أجسام كرتونية) */
export const AVATAR_COLORS = [
  "#8b5cf6", // بنفسجي
  "#3b82f6", // أزرق
  "#f97316", // برتقالي
  "#22c55e", // أخضر
  "#ec4899", // وردي
  "#eab308", // أصفر
  "#06b6d4", // سماوي
  "#ef4444", // أحمر
  "#a3e635", // ليموني
  "#f472b6", // زهري فاتح
  "#14b8a6", // فيروزي
  "#c084fc", // خزامى
] as const;

export const HATS = ["none", "cap", "crown", "shemagh", "headphones", "bow", "beanie", "party"] as const;
export const EYES = ["round", "happy", "sleepy", "star"] as const;

/** مدد المراحل بالملّي ثانية (تُضرب في معامل السرعة أثناء الاختبارات) */
export const TIMING = {
  introMin: 3200,
  introMax: 9000,
  listenLead: 900,
  listenTail: 900,
  countdownStep: 900,
  countdownStepHard: 700,
  recordLead: 150,
  recordTail: 400,
  collectMax: 8000,
  loadMax: 6000,
  revealIntro: 1700,
  revealPlayLead: 350,
  revealGap: 450,
  revealScore: 3800,
  vote: 15000,
  leaderboard: 6000,
  wheelIntro: 1800,
  wheelSpinLead: 400,
  wheelSpin: 5200,
  wheelPick: 10000,
  wheelResult: 3800,
  hostGrace: 20000,
  playerGrace: 60000,
  emptyRoomTtl: 5 * 60_000,
} as const;

export type TimingKey = keyof typeof TIMING;
