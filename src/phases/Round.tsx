// مراحل الجولة: الإعلان، الاستماع، العد التنازلي، التسجيل، جمع التسجيلات
import { useEffect, useRef, useState } from "react";
import type { RoomView } from "../../shared/types";
import { mic } from "../audio/mic";
import { director, referenceLevel } from "../game/director";
import { game } from "../game/client";
import { AvatarFace } from "../components/AvatarFace";
import { MicButton, useRaf, Waveform } from "../components/Mic";
import { Card } from "../components/ui";
import type { I18nKey } from "../lib/i18n";
import { useLang } from "../lib/lang";
import { msUntil, serverNow } from "../lib/clock";
import { useStore } from "../lib/store";

/** الوقت المتبقي حتى وقت خادم معين (يتحدث 10 مرات بالثانية) */
export function useRemaining(endsAt: number | null): number {
  const [left, setLeft] = useState(() => (endsAt ? Math.max(0, msUntil(endsAt)) : 0));
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setLeft(Math.max(0, msUntil(endsAt))), 100);
    setLeft(Math.max(0, msUntil(endsAt)));
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

export function TimerRing({ startAt, endAt, size = 120, children }: { startAt: number; endAt: number; size?: number; children?: React.ReactNode }) {
  const left = useRemaining(endAt);
  const total = Math.max(1, endAt - startAt);
  const k = Math.min(1, Math.max(0, left / total));
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
        <circle cx="60" cy="60" r={r} stroke="rgb(255 255 255 / 0.15)" strokeWidth="10" fill="none" />
        <circle cx="60" cy="60" r={r} stroke={k < 0.25 ? "#fb7185" : "#fb923c"} strokeWidth="10" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - k)} strokeLinecap="round" />
      </svg>
      <div className="relative text-center">
        <div className="font-display text-4xl tabular-nums">{Math.ceil(left / 1000)}</div>
        {children}
      </div>
    </div>
  );
}

/** تنبيه مبكر للمشارك إذا كان مايكه مكتومًا أو متوقفًا قبل التسجيل */
function MutedPrompt({ v }: { v: RoomView }) {
  const { t } = useLang();
  const m = useStore(mic.store);
  if (!v.participants.includes(game.me) || (m.status === "ready" && !m.muted)) return null;
  return (
    <Card className="flex animate-pop items-center gap-3 p-3 text-start">
      <span className="flex-1 font-bold text-rose-200">{m.status === "ready" ? t("phase.recordMuted") : t("gate.err.ended.body")}</span>
      <MicButton size={58} />
    </Card>
  );
}

export function Intro({ v }: { v: RoomView }) {
  const { t } = useLang();
  const ranked = [...v.players].filter((p) => v.participants.includes(p.id)).sort((a, b) => b.score - a.score);
  return (
    <div className="mx-auto w-full max-w-md space-y-4 px-3 text-center">
      <div className="animate-pop font-display text-6xl text-sun-300 drop-shadow-lg">{t("phase.intro", { round: v.round, total: v.totalRounds })}</div>
      <MutedPrompt v={v} />
      {v.sound && <div className="animate-pop text-lg text-white/80">{t(`cat.${v.sound.category}` as I18nKey)} • {"⭐".repeat(v.sound.difficulty)}</div>}
      <Card className="space-y-1.5 p-4">
        {ranked.map((p, i) => (
          <div key={p.id} className="flex animate-pop items-center gap-3" style={{ animationDelay: `${i * 70}ms` }}>
            <span className="w-6 font-display text-xl text-white/60">{i + 1}</span>
            <AvatarFace avatar={p.avatar} size={36} />
            <span className="flex-1 truncate text-start font-bold">{p.name}</span>
            <span className="font-display text-xl text-sun-300 tabular-nums">{p.score}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function RefBars() {
  const ref = useRef<HTMLDivElement>(null);
  const hist = useRef<number[]>([]);
  useRaf(() => {
    hist.current.push(referenceLevel());
    if (hist.current.length > 32) hist.current.shift();
    const kids = ref.current?.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) (kids[i] as HTMLElement).style.transform = `scaleY(${0.06 + (hist.current[i] ?? 0) * 0.94})`;
  });
  return (
    <div ref={ref} className="flex h-24 items-center justify-center gap-1" dir="ltr">
      {Array.from({ length: 32 }, (_, i) => (
        <span key={i} className="h-full w-2 rounded-full bg-gradient-to-t from-azure-400 to-grape-400" />
      ))}
    </div>
  );
}

export function Listen({ v }: { v: RoomView }) {
  const { t, lt } = useLang();
  const d = useStore(director);
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-3 text-center">
      <div className="animate-pop font-display text-4xl drop-shadow">{t("phase.listen")}</div>
      <MutedPrompt v={v} />
      {v.sound && (
        <Card className="space-y-2 p-5">
          <div className="text-7xl">{v.sound.emoji}</div>
          <div className="font-display text-3xl text-sun-300">{lt(v.sound.name)}</div>
          <RefBars />
          <div className="text-sm text-white/70">{d.refPlaying ? "🔊" : "⏳"} {t("phase.listenOnce")}</div>
        </Card>
      )}
    </div>
  );
}

export function Countdown({ v }: { v: RoomView }) {
  const { t } = useLang();
  const { steps, stepMs } = v.countdown ?? { steps: 3, stepMs: 900 };
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 50);
    return () => clearInterval(id);
  }, []);
  const idx = Math.floor((now - v.phaseAt) / stepMs);
  const label = idx < 0 ? String(steps) : idx < steps ? String(steps - idx) : t("phase.go");
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-3 text-center">
      <div key={label} className="countdown-num font-display text-[9rem] leading-none text-sun-300 drop-shadow-[0_8px_0_#7c2d12]" style={{ ["--step" as string]: `${stepMs}ms` }}>
        {label}
      </div>
      <MutedPrompt v={v} />
    </div>
  );
}

export function Record({ v }: { v: RoomView }) {
  const { t } = useLang();
  const d = useStore(director);
  const m = useStore(mic.store);
  const participant = v.participants.includes(game.me);
  const [silent, setSilent] = useState(false);
  const loudSince = useRef(performance.now());
  useRaf(() => {
    if (!d.recording) return;
    if (mic.level() > 0.25) loudSince.current = performance.now();
    const quiet = performance.now() - loudSince.current > 1600;
    if (quiet !== silent) setSilent(quiet);
  });
  if (!participant) {
    return (
      <Card className="mx-auto max-w-sm p-5 text-center">
        <div className="text-5xl">👀</div>
        <div className="font-bold">{t("phase.spectating")}</div>
      </Card>
    );
  }
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-3 text-center">
      <div className="animate-pop font-display text-5xl text-rose-300 drop-shadow">{m.muted ? t("phase.recordMuted") : t("phase.record")}</div>
      <Card className="flex flex-col items-center gap-3 p-4">
        {v.record && (
          <TimerRing startAt={v.record.startAt} endAt={v.record.endAt}>
            {d.recording && <div className="text-xs font-black text-rose-300">● REC</div>}
          </TimerRing>
        )}
        <Waveform />
        {m.muted ? <MicButton /> : silent && d.recording && <div className="animate-pop font-bold text-tang-300">{t("phase.silentHint")}</div>}
      </Card>
    </div>
  );
}

export function Collect({ v }: { v: RoomView }) {
  const { t } = useLang();
  const scoring = v.collect?.scoring || (v.collect?.audio !== null && v.collect?.audio !== undefined);
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-3 text-center">
      <div className="font-display text-4xl">{scoring ? t("phase.scoring") : t("phase.collect")}</div>
      <Card className="flex flex-wrap justify-center gap-3 p-4">
        {v.participants.map((id) => {
          const p = v.players.find((x) => x.id === id);
          return (
            <div key={id} className="flex flex-col items-center">
              <div className="relative">
                <AvatarFace avatar={game.avatarOf(id)} size={52} className={p?.uploaded ? "" : "animate-pulse"} />
                <span className="absolute -bottom-1 end-0 text-lg">{p?.uploaded ? "✅" : "⏳"}</span>
              </div>
              <div className="max-w-16 truncate text-xs font-bold">{game.nameOf(id)}</div>
            </div>
          );
        })}
      </Card>
      {scoring && <div className="text-xs text-white/55">🧪 {t("score.method")}</div>}
    </div>
  );
}
