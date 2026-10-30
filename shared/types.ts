// أنواع البيانات المشتركة وبروتوكول Socket.IO

export type Lang = "ar" | "en";
export type LocalText = { ar: string; en: string };

export type Category = "animals" | "machines" | "human" | "hard" | "saudi";
export type GameMode = "classic" | "laugh" | "hard" | "saudi";
export type RevealOrder = "random" | "fixed";
export type RecordChoice = "auto" | 4 | 6 | 8;
export type RoundChoice = 4 | 6 | 8 | 10;

export interface RoomSettings {
  maxPlayers: number;
  rounds: RoundChoice;
  recordSeconds: RecordChoice;
  categories: Category[];
  mode: GameMode;
  wheel: boolean;
  voiceChat: boolean;
  revealOrder: RevealOrder;
}

export interface Avatar {
  color: number;
  hat: number;
  eyes: number;
}

/**
 * حالة مايك اللاعب كما يبلّغ عنها متصفحه:
 * on = يعمل وغير مكتوم، muted = كتمه اللاعب، off = لا يوجد مسار مايك (لم يُفعّل/انقطع)، denied = رفض الصلاحية
 */
export type MicState = "on" | "muted" | "off" | "denied";

export type Phase =
  | "lobby"
  | "intro"
  | "listen"
  | "countdown"
  | "record"
  | "collect"
  | "reveal"
  | "vote"
  | "leaderboard"
  | "wheel"
  | "final";

export type SabotageId = "chipmunk" | "deep" | "echo" | "chop" | "fast" | "slow" | "replace";
export type WheelOutcome = "plus20" | "plus50" | "double" | "steal" | "shield" | "swap" | "sabotage";

export interface PlayerView {
  id: string;
  name: string;
  avatar: Avatar;
  connected: boolean;
  ready: boolean;
  mic: MicState;
  hostMuted: boolean;
  score: number;
  shield: boolean;
  doubleNext: boolean;
  /** عليه تخريب ينتظر تسجيله القادم (نوع التخريب سر حتى لحظة التشغيل) */
  marked: boolean;
  /** وصل تسجيله في هذه الجولة */
  uploaded: boolean;
  joinedAt: number;
}

export interface SoundInfo {
  id: string;
  pack: string;
  category: Category;
  name: LocalText;
  emoji: string;
  url: string;
  durationMs: number;
  difficulty: 1 | 2 | 3;
}

export interface PackInfo {
  id: string;
  category: Category;
  name: LocalText;
  description: LocalText;
  emoji: string;
  sounds: SoundInfo[];
}

export interface ScoreParts {
  pitch: number;
  rhythm: number;
  timing: number;
  energy: number;
  spectral: number;
}

/**
 * ok = تقييم موثوق. البقية حالات «غير موثوق» لا نخترع لها درجة:
 * silent صامت، too_short قصير جدًا، clipped تشبّع/تشويه، noisy ضجيج فقط، corrupt ملف تالف،
 * suspicious يطابق الملف الأصلي حرفيًا (تشغيل الصوت بدل تقليده)، muted كان المايك مكتومًا، missing لم يصل
 */
export type ScoreStatus = "ok" | "silent" | "too_short" | "clipped" | "noisy" | "corrupt" | "suspicious" | "muted" | "missing";

export interface ScoreResult {
  status: ScoreStatus;
  score: number | null;
  parts: ScoreParts | null;
  /** تفاصيل رقمية للاختبار والشفافية */
  debug?: Record<string, number>;
}

export interface RoundEntry {
  playerId: string;
  status: ScoreStatus;
  score: number | null;
  parts: ScoreParts | null;
  multiplier: number;
  points: number;
  votes: number;
  voteBonus: number;
  sabotage: SabotageId | null;
  durationMs: number;
  playMs: number;
}

export interface RevealCurrent {
  playerId: string;
  sabotage: SabotageId | null;
  hasAudio: boolean;
  playAt: number | null;
  playMs: number;
  /** يظهر فقط في خطوة عرض الدرجة */
  result: RoundEntry | null;
}

export interface RevealView {
  order: string[];
  index: number;
  step: "intro" | "play" | "score";
  current: RevealCurrent | null;
  done: RoundEntry[];
}

export interface VoteView {
  voters: string[];
  /** بعد إغلاق التصويت فقط */
  tally: Record<string, number> | null;
}

export interface WheelView {
  spinnerId: string;
  slices: WheelOutcome[];
  stage: "intro" | "spin" | "pick" | "result";
  spinAt: number | null;
  spinMs: number;
  sliceIndex: number | null;
  /** موضع المؤشر داخل الشريحة 0..1 */
  sliceOffset: number;
  outcome: WheelOutcome | null;
  pickEndsAt: number | null;
  targetId: string | null;
  blocked: boolean;
  amount: number;
}

export interface FinalAward {
  playerId: string;
  value: number;
  round?: number;
  soundId?: string;
}

export interface FinalView {
  reason: "completed" | "not_enough_players";
  ranking: { id: string; name: string; avatar: Avatar; score: number }[];
  best: FinalAward | null;
  mostGained: FinalAward | null;
  mostSabotaged: FinalAward | null;
  funniest: FinalAward | null;
}

export interface RoomView {
  code: string;
  name: string;
  hostId: string;
  settings: RoomSettings;
  players: PlayerView[];
  phase: Phase;
  phaseAt: number;
  phaseEndsAt: number | null;
  now: number;
  /** الدردشة الصوتية مسموحة الآن؟ (تُقفل أثناء الاستماع والتسجيل وتشغيل التسجيلات) */
  voiceOpen: boolean;
  round: number;
  totalRounds: number;
  participants: string[];
  sound: SoundInfo | null;
  listenAt: number | null;
  countdown: { steps: number; stepMs: number } | null;
  record: { startAt: number; endAt: number } | null;
  /** audio = من وصلت تسجيلاتهم الصوتية (بعد انتهاء الاستلام) */
  collect: { scoring: boolean; audio: string[] | null } | null;
  reveal: RevealView | null;
  vote: VoteView | null;
  leaderboard: RoundEntry[] | null;
  wheel: WheelView | null;
  final: FinalView | null;
  rev: number;
}

export type JoinError =
  | "not_found"
  | "full"
  | "kicked"
  | "bad_name"
  | "bad_request"
  | "rate_limited"
  | "expired";

export type JoinResult =
  | { ok: true; code: string; playerId: string; token: string; ice: IceServer[] }
  | { ok: false; error: JoinError };

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface CreatePayload {
  roomName: string;
  name: string;
  avatar: Avatar;
  settings: Partial<RoomSettings>;
  mic: MicState;
  /** معرّف عشوائي محفوظ في المتصفح لمنع المطرود من العودة */
  device: string;
}

export interface JoinPayload {
  code: string;
  name: string;
  avatar: Avatar;
  mic: MicState;
  device: string;
}

export interface ResumePayload {
  code: string;
  playerId: string;
  token: string;
  mic: MicState;
}

export interface UploadPayload {
  round: number;
  wav: ArrayBuffer | Uint8Array;
  /** كان المايك مكتومًا طوال مدة التسجيل */
  mutedAll: boolean;
}

export type RtcData =
  | { type: "description"; sdp: { type: "offer" | "answer" | "pranswer" | "rollback"; sdp?: string } }
  | { type: "candidate"; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null };

export interface ToastEvent {
  key: string;
  vars?: Record<string, string | number>;
}

export interface ServerToClient {
  "room:state": (view: RoomView) => void;
  "room:kicked": (reason: "kicked" | "replaced" | "closed") => void;
  "room:speaking": (p: { id: string; speaking: boolean }) => void;
  "rtc:signal": (p: { from: string; data: RtcData }) => void;
  "game:recording": (p: { round: number; playerId: string; wav: ArrayBuffer }) => void;
  toast: (t: ToastEvent) => void;
}

export interface ClientToServer {
  "room:create": (p: CreatePayload, ack: (r: JoinResult) => void) => void;
  "room:join": (p: JoinPayload, ack: (r: JoinResult) => void) => void;
  "room:resume": (p: ResumePayload, ack: (r: JoinResult) => void) => void;
  "room:leave": (ack?: (r: ActionResult) => void) => void;
  "room:ready": (ready: boolean) => void;
  "room:settings": (patch: Partial<RoomSettings>, ack?: (r: ActionResult) => void) => void;
  "room:kick": (playerId: string) => void;
  "room:host-mute": (p: { playerId: string; muted: boolean }) => void;
  "room:start": (ack?: (r: ActionResult) => void) => void;
  "room:lobby": () => void;
  "room:profile": (p: { name?: string; avatar?: Avatar }) => void;
  "player:mic": (state: MicState) => void;
  "player:speaking": (speaking: boolean) => void;
  "player:report": (p: { playerId: string; reason: string }, ack?: (r: ActionResult) => void) => void;
  "rtc:signal": (p: { to: string; data: RtcData }) => void;
  "game:loaded": (p: { round: number; what: "sound" | "recordings" }) => void;
  "game:upload": (p: UploadPayload, ack?: (r: ActionResult) => void) => void;
  "game:vote": (playerId: string) => void;
  "wheel:pick": (playerId: string) => void;
  "time:ping": (t0: number, ack: (serverNow: number) => void) => void;
}
