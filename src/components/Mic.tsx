// أدوات المايك في الواجهة: زر التشغيل/الكتم الكبير، مؤشر الحالة الدائم، عداد المستوى، وموجة الصوت
import { useEffect, useRef } from "react";
import { mic } from "../audio/mic";
import { voice } from "../audio/voice";
import { director } from "../game/director";
import { useLang } from "../lib/lang";
import { sfx } from "../lib/sfx";
import { useStore } from "../lib/store";
import { unlockAudio } from "../audio/engine";

export function useRaf(fn: (t: number) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let id = 0;
    const loop = (t: number) => {
      ref.current(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

export type MicMode = "off" | "muted" | "locked" | "recording" | "live";

export function useMicMode(inRoom: boolean): MicMode {
  const m = useStore(mic.store);
  const v = useStore(voice.store);
  const d = useStore(director);
  if (m.status !== "ready") return "off";
  if (m.muted) return "muted";
  if (d.recording) return "recording";
  if (inRoom && (!v.enabled || !v.open)) return "locked";
  return "live";
}

const ICON: Record<MicMode, string> = { off: "🎙️", muted: "🔇", locked: "🔒", recording: "⏺", live: "🎙️" };

/** زر المايك الكبير (تشغيل/كتم) — يظهر في اللوبي وأثناء اللعب */
export function MicButton({ inRoom = true, size = 76 }: { inRoom?: boolean; size?: number }) {
  const { t } = useLang();
  const mode = useMicMode(inRoom);
  const ring = useRef<HTMLSpanElement>(null);
  useRaf(() => {
    if (ring.current) ring.current.style.transform = `scale(${1 + mic.level() * 0.45})`;
  });
  const colors: Record<MicMode, string> = {
    off: "from-slate-500 to-slate-700 [--btn-depth:#1e293b]",
    muted: "from-rose-400 to-rose-600 [--btn-depth:#881337]",
    locked: "from-azure-400 to-azure-600 [--btn-depth:#1e3a8a]",
    recording: "from-rose-500 to-red-700 [--btn-depth:#7f1d1d] animate-pulse-ring",
    live: "from-mint-400 to-emerald-600 [--btn-depth:#065f46]",
  };
  const label = mode === "off" ? t("mic.enable") : mode === "muted" ? t("mic.unmute") : t("mic.mute");
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-label={label}
        aria-pressed={mode !== "muted" && mode !== "off"}
        title={label}
        onClick={() => {
          sfx("click");
          if (mode === "off") {
            unlockAudio();
            void mic.request();
          } else mic.toggleMute();
        }}
        style={{ width: size, height: size }}
        className={`btn-3d relative grid place-items-center rounded-full bg-gradient-to-b text-3xl text-white ${colors[mode]}`}
      >
        {(mode === "live" || mode === "recording" || mode === "locked") && (
          <span ref={ring} className="pointer-events-none absolute inset-0 rounded-full border-4 border-white/40 transition-transform duration-75" />
        )}
        <span className="relative">{ICON[mode]}</span>
        {mode === "muted" && <span className="absolute h-1.5 w-12 rotate-45 rounded bg-white" />}
      </button>
      <span className="text-xs font-bold text-white/80">{label}</span>
    </div>
  );
}

/** مؤشر دائم يوضح متى يكون المايك نشطًا */
export function MicPill({ inRoom, onClick }: { inRoom: boolean; onClick?: () => void }) {
  const { t } = useLang();
  const mode = useMicMode(inRoom);
  const m = useStore(mic.store);
  const text =
    mode === "recording"
      ? t("mic.recording")
      : mode === "muted"
        ? t("mic.muted")
        : mode === "locked"
          ? t("mic.locked")
          : mode === "live"
            ? t("mic.on")
            : m.status === "denied"
              ? t("mic.denied")
              : t("mic.off");
  const tone =
    mode === "recording"
      ? "bg-red-600 text-white animate-pulse"
      : mode === "live"
        ? "bg-emerald-500/90 text-white"
        : mode === "muted"
          ? "bg-rose-500/85 text-white"
          : mode === "locked"
            ? "bg-azure-500/80 text-white"
            : "bg-white/15 text-white/80";
  return (
    <button type="button" onClick={onClick} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold shadow ${tone}`} aria-live="polite">
      <span>{mode === "recording" ? "●" : ICON[mode]}</span>
      <span className="max-w-[9rem] truncate">{text}</span>
      {m.interrupted && <span title="interrupted">⚠️</span>}
    </button>
  );
}

/** عداد مستوى الصوت (أعمدة متحركة) */
export function LevelMeter({ bars = 24, className = "" }: { bars?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const hist = useRef<number[]>([]);
  useRaf(() => {
    const el = ref.current;
    if (!el) return;
    hist.current.push(mic.level());
    if (hist.current.length > bars) hist.current.shift();
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      const v = hist.current[i] ?? 0;
      (kids[i] as HTMLElement).style.transform = `scaleY(${0.08 + v * 0.92})`;
      (kids[i] as HTMLElement).style.opacity = String(0.35 + v * 0.65);
    }
  });
  return (
    <div ref={ref} className={`flex h-20 items-center justify-center gap-1 ${className}`} dir="ltr" aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="h-full w-2 origin-center rounded-full bg-gradient-to-t from-azure-400 via-grape-400 to-tang-400 transition-transform duration-75" />
      ))}
    </div>
  );
}

/** موجة الصوت الحية أثناء التسجيل (Canvas) */
export function Waveform({ className = "", color = "#fb923c" }: { className?: string; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useRef(new Float32Array(new ArrayBuffer(1024 * 4)));
  useRaf(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth * dpr;
    const h = c.clientHeight * dpr;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const ok = mic.waveform(data.current);
    g.lineWidth = 4 * dpr;
    g.lineCap = "round";
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 12 * dpr;
    g.beginPath();
    const d = data.current;
    for (let x = 0; x < w; x += 3 * dpr) {
      const v = ok ? d[Math.floor((x / w) * d.length)] : 0;
      const y = h / 2 + v * h * 1.6;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  });
  return <canvas ref={ref} className={`h-24 w-full ${className}`} aria-hidden />;
}
