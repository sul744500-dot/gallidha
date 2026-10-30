import { useEffect, useState } from "react";
import type { RoundEntry, ScoreParts } from "../../shared/types";
import type { I18nKey } from "../lib/i18n";
import { useLang } from "../lib/lang";

function useCountUp(target: number, ms = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const PARTS: (keyof ScoreParts)[] = ["pitch", "rhythm", "timing", "energy", "spectral"];

function color(v: number) {
  return v >= 80 ? "from-mint-400 to-emerald-500" : v >= 55 ? "from-sun-300 to-tang-400" : "from-rose-400 to-rose-600";
}

/** درجة التقليد مع تفاصيل المعايير، أو رسالة «غير موثوق» بدون أي رقم مخترع */
export function ScoreCard({ entry }: { entry: RoundEntry }) {
  const { t } = useLang();
  const score = useCountUp(entry.score ?? 0);
  if (entry.status !== "ok" || entry.score === null || !entry.parts) {
    return (
      <div className="animate-pop rounded-3xl bg-black/30 p-4 text-center">
        <div className="text-4xl">{entry.status === "suspicious" ? "🤨" : entry.status === "muted" ? "🔇" : entry.status === "missing" ? "📭" : "🤷"}</div>
        <div className="mt-1 font-bold">{t(`score.status.${entry.status}` as I18nKey)}</div>
        <div className="font-display text-2xl text-white/60">0</div>
      </div>
    );
  }
  return (
    <div className="animate-pop space-y-3 rounded-3xl bg-black/30 p-4">
      <div className="text-center">
        <div className="text-sm font-bold text-white/70">{t("score.overall")}</div>
        <div className={`font-display text-7xl leading-none tabular-nums ${entry.score >= 80 ? "text-mint-400" : entry.score >= 55 ? "text-sun-300" : "text-rose-300"}`}>
          {score}
          <span className="text-2xl text-white/50">/100</span>
        </div>
        {entry.score === 100 && <div className="animate-wiggle font-display text-2xl text-sun-300">{t("reveal.perfect")}</div>}
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {PARTS.map((k, i) => (
          <div key={k} className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 font-semibold text-white/80">{t(`score.${k}` as I18nKey)}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full bg-gradient-to-l ${color(entry.parts![k])} transition-[width] duration-700`} style={{ width: `${entry.parts![k]}%`, transitionDelay: `${200 + i * 120}ms` }} />
            </div>
            <span className="w-8 text-end font-bold tabular-nums">{entry.parts![k]}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 font-display text-2xl text-sun-300">
        {t("reveal.points", { n: entry.points })}
        {entry.multiplier > 1 && <span className="rounded-full bg-sun-300 px-2 text-base text-night-900">{t("reveal.double")}</span>}
      </div>
    </div>
  );
}
