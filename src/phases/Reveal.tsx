// عرض التسجيلات بالدور، التصويت (وضع الضحك)، وترتيب الجولة
import type { RoomView } from "../../shared/types";
import { AvatarFace } from "../components/AvatarFace";
import { ScoreCard } from "../components/ScoreCard";
import { useRaf } from "../components/Mic";
import { Button, Card } from "../components/ui";
import { director, liveLevel } from "../game/director";
import { game } from "../game/client";
import type { I18nKey } from "../lib/i18n";
import { useLang } from "../lib/lang";
import { useStore } from "../lib/store";
import { useRef } from "react";

function SpeakingFace({ id, size }: { id: string; size: number }) {
  const el = useRef<HTMLDivElement>(null);
  useRaf(() => {
    const l = liveLevel(id);
    if (el.current) el.current.style.transform = `scale(${1 + l * 0.12}) rotate(${(l - 0.2) * 6}deg)`;
  });
  return (
    <div ref={el} className="transition-transform duration-75">
      <AvatarFace avatar={game.avatarOf(id)} size={size} />
    </div>
  );
}

export function Reveal({ v }: { v: RoomView }) {
  const { t } = useLang();
  const d = useStore(director);
  const r = v.reveal;
  if (!r?.current) return null;
  const cur = r.current;
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-3 text-center">
      <div className="text-sm font-bold text-white/60">
        {t("phase.reveal")} {r.index + 1}/{r.order.length}
      </div>
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-center gap-3">
          <SpeakingFace id={cur.playerId} size={84} />
          <div className="text-start">
            <div className="font-display text-3xl">{game.nameOf(cur.playerId)}</div>
            {r.step === "play" && <div className="text-sm text-white/70">{cur.hasAudio ? (d.playingId === cur.playerId ? `🔊 ${t("reveal.playing")}` : "⏳") : t("reveal.noAudio")}</div>}
          </div>
        </div>
        {cur.sabotage && r.step !== "intro" && (
          <div className="animate-pop rounded-2xl bg-gradient-to-l from-rose-500 to-grape-600 p-2 font-display text-2xl">
            {t("reveal.sabotaged")} {t(`sab.${cur.sabotage}` as I18nKey)}
          </div>
        )}
        {r.step === "score" && cur.result && <ScoreCard entry={cur.result} />}
      </Card>
      {r.done.length > 1 && (
        <div className="flex flex-wrap justify-center gap-2">
          {r.done.slice(0, -1).map((e) => (
            <div key={e.playerId} className="flex items-center gap-1 rounded-full bg-black/25 px-2 py-1 text-xs">
              <AvatarFace avatar={game.avatarOf(e.playerId)} size={22} />
              <span>{game.nameOf(e.playerId)}</span>
              <b className="text-sun-300">{e.score ?? "—"}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Vote({ v }: { v: RoomView }) {
  const { t } = useLang();
  const voted = v.vote?.voters.includes(game.me);
  const canVote = v.participants.includes(game.me);
  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-3 text-center">
      <div className="font-display text-4xl">{t("phase.vote")}</div>
      <div className="text-sm text-white/65">{voted ? t("phase.voted") : t("phase.voteHint")}</div>
      <div className="grid grid-cols-2 gap-2">
        {v.participants
          .filter((id) => id !== game.me)
          .map((id) => (
            <Button key={id} variant="grape" disabled={!canVote} onClick={() => game.emit("game:vote", id)} className="flex-col py-3">
              <AvatarFace avatar={game.avatarOf(id)} size={48} />
              <span className="truncate">{game.nameOf(id)}</span>
            </Button>
          ))}
      </div>
    </div>
  );
}

export function Leaderboard({ v }: { v: RoomView }) {
  const { t } = useLang();
  const totals = [...v.players].sort((a, b) => b.score - a.score);
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-3 px-3 sm:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-2 font-display text-2xl">{t("phase.leaderboard")}</h2>
        {(v.leaderboard ?? []).map((e, i) => (
          <div key={e.playerId} className="flex animate-pop items-center gap-2 py-1" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="w-6 font-display text-lg text-white/60">{i + 1}</span>
            <AvatarFace avatar={game.avatarOf(e.playerId)} size={34} />
            <span className="flex-1 truncate text-start font-bold">{game.nameOf(e.playerId)}</span>
            {e.votes > 0 && <span className="text-xs">😂×{e.votes}</span>}
            {e.sabotage && <span title={t(`sab.${e.sabotage}` as I18nKey)}>😈</span>}
            <span className="font-display text-lg text-mint-400 tabular-nums">+{e.points + e.voteBonus}</span>
          </div>
        ))}
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-display text-2xl">{t("phase.total")}</h2>
        {totals.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2 py-1">
            <span className="w-6 font-display text-lg text-white/60">{i + 1}</span>
            <AvatarFace avatar={p.avatar} size={34} />
            <span className="flex-1 truncate text-start font-bold">{p.name}</span>
            <span className="font-display text-xl text-sun-300 tabular-nums">{p.score}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
