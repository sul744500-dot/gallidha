// كلمات المقطع للاعب: يقلّدها بالكلمات نفسها، والتنبيه أن الهمهمة «ممممم» ما تجيب نقاط
import type { SoundInfo } from "../../shared/types";
import { useLang } from "../lib/lang";

export function SayWords({ sound, compact = false }: { sound: SoundInfo; compact?: boolean }) {
  const { t, lt } = useLang();
  if (!sound.speech && !sound.words) return null;
  return (
    <div className={`animate-pop space-y-1 ${compact ? "" : "pt-1"}`}>
      {sound.words && (
        <div className="rounded-2xl bg-sun-300/15 px-3 py-2 ring-1 ring-sun-300/40">
          {!compact && <div className="text-xs font-bold text-sun-300/90">{t("phase.sayWords")}</div>}
          <div className={`font-display leading-snug text-white ${compact ? "text-xl" : "text-2xl"}`} dir="auto">
            «{lt(sound.words)}»
          </div>
        </div>
      )}
      {sound.speech && <div className="text-xs font-semibold text-white/65">{t("phase.noHum")}</div>}
    </div>
  );
}
