// التتويج: منصة المراكز الثلاثة، الجوائز، وأزرار ما بعد المباراة
import { useEffect } from "react";
import confetti from "canvas-confetti";
import { AVATAR_COLORS } from "../../shared/constants";
import type { FinalAward, RoomView } from "../../shared/types";
import { buildPlayback, playAt } from "../audio/playback";
import { AvatarFace } from "../components/AvatarFace";
import { Button, Card } from "../components/ui";
import { game } from "../game/client";
import { useLang } from "../lib/lang";
import { prefs } from "../lib/prefs";
import { copyText, shareOrCopy, useInviteLink } from "../lib/share";
import type { I18nKey } from "../lib/i18n";

async function resultCard(v: RoomView, t: (k: I18nKey, vars?: Record<string, string | number>) => string): Promise<File | null> {
  const f = v.final!;
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1350;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createLinearGradient(0, 0, 0, 1350);
  grad.addColorStop(0, "#5b21b6");
  grad.addColorStop(0.55, "#1c1146");
  grad.addColorStop(1, "#0a061c");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1080, 1350);
  g.textAlign = "center";
  g.direction = "rtl";
  g.fillStyle = "#fde68a";
  g.font = "120px Lalezar, sans-serif";
  g.fillText("قلّدها إذا تقدر", 540, 190);
  g.fillStyle = "#a78bfa";
  g.font = "44px Lalezar, sans-serif";
  g.fillText("GALLIDHA", 540, 260);
  g.fillStyle = "#fff";
  g.font = "80px Lalezar, sans-serif";
  g.fillText(t("final.title"), 540, 400);
  f.ranking.slice(0, 5).forEach((r, i) => {
    const y = 540 + i * 150;
    g.fillStyle = i === 0 ? "rgba(253,224,71,0.25)" : "rgba(255,255,255,0.08)";
    g.beginPath();
    g.roundRect(110, y - 70, 860, 120, 40);
    g.fill();
    g.fillStyle = AVATAR_COLORS[r.avatar.color % AVATAR_COLORS.length];
    g.beginPath();
    g.arc(880, y - 10, 42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "64px Lalezar, sans-serif";
    g.textAlign = "right";
    g.fillText(`${["🥇", "🥈", "🥉", "4", "5"][i]} ${r.name}`, 810, y + 10);
    g.textAlign = "left";
    g.fillStyle = "#fde047";
    g.fillText(String(r.score), 160, y + 10);
  });
  g.textAlign = "center";
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.font = "36px sans-serif";
  g.fillText("gallidha", 540, 1300);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  return blob ? new File([blob], "gallidha-result.png", { type: "image/png" }) : null;
}

function Award({ icon, title, award, extra }: { icon: string; title: string; award: FinalAward | null; extra?: string }) {
  const { t } = useLang();
  if (!award) return null;
  return (
    <Card className="flex animate-pop items-center gap-3 p-3">
      <span className="text-3xl">{icon}</span>
      <AvatarFace avatar={game.avatarOf(award.playerId)} size={40} />
      <div className="min-w-0 flex-1 text-start">
        <div className="text-xs font-bold text-white/60">{title}</div>
        <div className="truncate font-bold">{game.nameOf(award.playerId)}</div>
        {award.round && <div className="text-[11px] text-white/50">{t("final.round", { n: award.round })}</div>}
      </div>
      <div className="font-display text-2xl text-sun-300">{extra ?? award.value}</div>
    </Card>
  );
}

export function Final({ v }: { v: RoomView }) {
  const { t } = useLang();
  const f = v.final;
  const { link } = useInviteLink(v.code);
  const amHost = v.hostId === game.me;
  useEffect(() => {
    if (prefs.get().reduceMotion) return;
    const end = Date.now() + 2500;
    const id = setInterval(() => {
      if (Date.now() > end) return clearInterval(id);
      void confetti({ particleCount: 40, spread: 80, origin: { x: Math.random(), y: 0.2 }, colors: ["#fb923c", "#a78bfa", "#38bdf8", "#fde047"], disableForReducedMotion: true });
    }, 250);
    return () => clearInterval(id);
  }, []);
  if (!f) return null;
  const podium = [f.ranking[1], f.ranking[0], f.ranking[2]];
  const heights = ["h-24", "h-36", "h-16"];
  const bestRec = f.best ? game.recordings.get(`${f.best.round}:${f.best.playerId}`) : undefined;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 px-3 text-center">
      <h1 className="font-display text-5xl text-sun-300 drop-shadow">{t("final.title")}</h1>
      {f.reason === "not_enough_players" && <p className="text-sm text-white/70">{t("final.notEnough")}</p>}
      <div className="flex items-end justify-center gap-2" dir="ltr">
        {podium.map((r, i) =>
          r ? (
            <div key={r.id} className="flex w-28 flex-col items-center">
              <AvatarFace avatar={r.avatar} size={i === 1 ? 92 : 70} className={i === 1 ? "animate-float" : ""} />
              <div className="w-full truncate font-bold" dir="auto">
                {r.name}
              </div>
              <div className="font-display text-xl text-sun-300">{t("final.points", { n: r.score })}</div>
              <div className={`mt-1 w-full rounded-t-2xl ${heights[i]} grid place-items-center bg-gradient-to-b ${i === 1 ? "from-sun-300 to-tang-500" : i === 0 ? "from-slate-200 to-slate-400" : "from-tang-300 to-tang-600"} font-display text-4xl text-night-900`}>
                {i === 1 ? "1" : i === 0 ? "2" : "3"}
              </div>
            </div>
          ) : (
            <div key={i} className="w-28" />
          ),
        )}
      </div>
      {f.ranking.length > 3 && (
        <Card className="p-3">
          {f.ranking.slice(3).map((r, i) => (
            <div key={r.id} className="flex items-center gap-2 py-1">
              <span className="w-6 font-display text-white/60">{i + 4}</span>
              <AvatarFace avatar={r.avatar} size={28} />
              <span className="flex-1 truncate text-start">{r.name}</span>
              <b className="text-sun-300">{r.score}</b>
            </div>
          ))}
        </Card>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Award icon="🎯" title={t("final.best")} award={f.best} extra={f.best ? `${f.best.value}/100` : undefined} />
        <Award icon="🚀" title={t("final.mostGained")} award={f.mostGained} extra={f.mostGained ? `+${f.mostGained.value}` : undefined} />
        <Award icon="😈" title={t("final.mostSabotaged")} award={f.mostSabotaged} extra={f.mostSabotaged ? `×${f.mostSabotaged.value}` : undefined} />
        <Award icon="😂" title={t("final.funniest")} award={f.funniest} extra={f.funniest ? `😂×${f.funniest.value}` : undefined} />
      </div>
      {bestRec && (
        <Button size="sm" variant="ghost" onClick={() => playAt(buildPlayback(bestRec, null, "best"), null)}>
          ▶ {t("final.replay")} — {t("final.best")}
        </Button>
      )}
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        {amHost ? (
          <>
            <Button size="lg" onClick={() => void game.action("room:start")}>
              🔁 {t("final.again")}
            </Button>
            <Button size="lg" variant="grape" onClick={() => game.emit("room:lobby")}>
              🏠 {t("final.lobby")}
            </Button>
          </>
        ) : (
          <span className="self-center text-sm text-white/70">{t("final.waitHost")}</span>
        )}
        <Button size="lg" variant="azure" onClick={() => void copyText(link).then((ok) => ok && game.toast({ key: "toast.copied" }))}>
          🔗 {t("final.copy")}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          onClick={async () => {
            const file = await resultCard(v, t);
            const top = f.ranking[0];
            await shareOrCopy({ title: t("app.name"), text: t("final.shareText", { n: top?.score ?? 0 }), url: link, files: file ? [file] : undefined });
          }}
        >
          📤 {t("final.share")}
        </Button>
      </div>
    </div>
  );
}
