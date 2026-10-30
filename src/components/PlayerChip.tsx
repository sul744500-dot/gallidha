import { useRef } from "react";
import type { PlayerView } from "../../shared/types";
import { liveLevel } from "../game/director";
import { useLang } from "../lib/lang";
import { AvatarFace } from "./AvatarFace";
import { useRaf } from "./Mic";

/** بطاقة لاعب: صورته، اسمه، نقاطه، حالته (جاهز/المايك/الاتصال) ومؤشر يتفاعل مع صوته */
export function PlayerChip({ p, me, host, compact, showReady, onClick, highlight }: { p: PlayerView; me: boolean; host: boolean; compact?: boolean; showReady?: boolean; onClick?: () => void; highlight?: boolean }) {
  const { t } = useLang();
  const ring = useRef<HTMLDivElement>(null);
  const mouth = useRef(0);
  const face = useRef<HTMLDivElement>(null);
  useRaf(() => {
    const l = p.connected ? liveLevel(p.id) : 0;
    mouth.current = mouth.current * 0.6 + l * 0.4;
    if (ring.current) {
      ring.current.style.opacity = String(Math.min(1, mouth.current * 2.2));
      ring.current.style.transform = `scale(${1 + mouth.current * 0.18})`;
    }
    if (face.current) face.current.style.transform = `translateY(${-mouth.current * 4}px) scaleY(${1 + mouth.current * 0.06})`;
  });
  const micIcon = p.hostMuted ? "🚫" : p.mic === "on" ? "🎙️" : p.mic === "muted" ? "🔇" : "❌";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`relative flex shrink-0 flex-col items-center rounded-3xl px-2 pb-2 pt-1 text-center transition ${compact ? "w-[4.6rem]" : "w-24"} ${highlight ? "bg-tang-500/30 ring-2 ring-tang-400" : me ? "bg-white/15 ring-1 ring-white/30" : "bg-black/25"} ${p.connected ? "" : "opacity-60"}`}
      aria-label={p.name}
    >
      <div className="relative">
        <div ref={ring} className="absolute inset-0 rounded-full bg-mint-400/50 opacity-0 blur-md" />
        <div ref={face} className="relative">
          <AvatarFace avatar={p.avatar} size={compact ? 50 : 60} dim={!p.connected} />
        </div>
        {host && <span className="absolute -top-1 start-0 text-lg" title={t("lobby.host")}>👑</span>}
        <span className="absolute -bottom-1 end-0 rounded-full bg-night-900/90 px-1 text-sm" title={p.mic}>
          {micIcon}
        </span>
        {p.shield && <span className="absolute -top-1 end-0 text-base" title="shield">🛡️</span>}
        {p.doubleNext && <span className="absolute top-5 -end-2 rounded-full bg-sun-300 px-1 text-[10px] font-black text-night-900">×2</span>}
        {p.marked && <span className="absolute top-5 -start-2 text-base" title="sabotage">😈</span>}
      </div>
      <div className={`mt-1 w-full truncate font-bold ${compact ? "text-xs" : "text-sm"}`}>
        {p.name}
        {me && <span className="text-tang-300"> ({t("lobby.you")})</span>}
      </div>
      <div className="font-display text-base leading-none text-sun-300 tabular-nums">{p.score}</div>
      {showReady && <div className={`mt-0.5 text-[10px] font-bold ${p.ready ? "text-mint-400" : "text-white/45"}`}>{p.ready ? `✓ ${t("lobby.isReady")}` : t("lobby.notReady")}</div>}
      {!p.connected && <div className="text-[10px] text-rose-300">{t("status.offline")}</div>}
    </button>
  );
}
