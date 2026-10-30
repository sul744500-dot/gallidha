// اللوبي: كود الغرفة ورابط الدعوة و QR، اللاعبين، الجاهزية، إعدادات المضيف وأدوات الإشراف
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { MIN_PLAYERS } from "../../shared/constants";
import type { PlayerView, RoomView } from "../../shared/types";
import { voice } from "../audio/voice";
import { AvatarFace } from "../components/AvatarFace";
import { Button, Card } from "../components/ui";
import { game } from "../game/client";
import type { I18nKey } from "../lib/i18n";
import { useLang } from "../lib/lang";
import { copyText, shareOrCopy, useInviteLink } from "../lib/share";
import { sfx } from "../lib/sfx";
import { useStore } from "../lib/store";
import { RoomSettingsForm } from "../screens/Menus";

function QR({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(text, { margin: 1, width: 220, color: { dark: "#140c33", light: "#ffffff" } }).then(setSrc);
  }, [text]);
  return src ? <img src={src} alt="QR" className="h-28 w-28 rounded-2xl bg-white p-1" /> : null;
}

function PlayerActions({ p, v, onClose }: { p: PlayerView; v: RoomView; onClose: () => void }) {
  const { t } = useLang();
  const vs = useStore(voice.store);
  const amHost = v.hostId === game.me;
  const [reported, setReported] = useState(false);
  const localMuted = vs.localMuted.includes(p.id);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
      <Card className="animate-pop space-y-3 p-5">
        <div className="flex items-center gap-3">
          <AvatarFace avatar={p.avatar} size={64} />
          <div className="font-display text-2xl">{p.name}</div>
        </div>
        <div className="grid gap-2">
          <Button variant="ghost" onClick={() => voice.toggleLocalMute(p.id)}>
            {localMuted ? "🔊 " + t("lobby.unmuteLocal") : "🔇 " + t("lobby.muteLocal")}
          </Button>
          {amHost && (
            <Button variant="grape" onClick={() => game.emit("room:host-mute", { playerId: p.id, muted: !p.hostMuted })}>
              {p.hostMuted ? "🔊 " + t("lobby.unmuteAll") : "🚫 " + t("lobby.muteAll")}
            </Button>
          )}
          {amHost && (
            <Button
              variant="danger"
              onClick={() => {
                game.emit("room:kick", p.id);
                onClose();
              }}
            >
              👢 {t("lobby.kick")}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={reported}
            onClick={async () => {
              const reason = window.prompt(t("lobby.reportPrompt")) ?? "";
              const r = await game.report(p.id, reason);
              if (r.ok) {
                setReported(true);
                game.toast({ key: "lobby.reported" });
              }
            }}
          >
            🚩 {reported ? t("lobby.reported") : t("lobby.report")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </Card>
      </div>
    </div>
  );
}

export function Lobby({ v }: { v: RoomView }) {
  const { t } = useLang();
  const { link, lan } = useInviteLink(v.code);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [actionFor, setActionFor] = useState<PlayerView | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [err, setErr] = useState("");
  const me = v.players.find((p) => p.id === game.me);
  const amHost = v.hostId === game.me;
  const eligible = v.players.filter((p) => p.connected && (p.mic === "on" || p.mic === "muted"));
  const others = v.players.filter((p) => p.id !== v.hostId && p.connected);
  const allReady = others.every((p) => p.ready);

  const start = async () => {
    if (!allReady && !confirmStart) {
      setConfirmStart(true);
      return;
    }
    const r = await game.action("room:start");
    if (!r.ok) {
      sfx("error");
      setErr(r.error === "not_enough" ? t("lobby.needTwo") : r.error);
    }
    setConfirmStart(false);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-3">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <QR text={link} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm font-bold text-white/70">{v.name}</div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-white/60">{t("lobby.code")}</span>
            <span className="font-display text-4xl tracking-[0.2em] text-sun-300" dir="ltr">
              {v.code}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="azure"
              onClick={async () => {
                if (await copyText(link)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }
              }}
            >
              🔗 {copied ? t("lobby.copied") : t("lobby.copy")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void shareOrCopy({ title: t("app.name"), text: t("lobby.shareText", { code: v.code }), url: link })}>
              📤 {t("lobby.share")}
            </Button>
          </div>
          {lan && <div className="text-[11px] text-white/55" dir="ltr">{link}</div>}
          {lan && <div className="text-[11px] text-white/55">{t("lobby.lanHint")}</div>}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-xl">{t("lobby.players", { n: v.players.length, max: v.settings.maxPlayers })}</h2>
          <span className="text-xs text-white/60">{t("lobby.summary", { rounds: v.settings.rounds, mode: t(`mode.${v.settings.mode}` as I18nKey) })}</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
          {v.players.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => p.id !== game.me && setActionFor(p)}
              className={`flex flex-col items-center rounded-2xl p-2 ${p.id === game.me ? "bg-white/15" : "bg-black/25 hover:bg-white/10"} ${p.connected ? "" : "opacity-50"}`}
            >
              <div className="relative">
                <AvatarFace avatar={p.avatar} size={56} />
                {p.id === v.hostId && <span className="absolute -top-2 start-0">👑</span>}
                <span className="absolute -bottom-1 end-0 text-sm">{p.hostMuted ? "🚫" : p.mic === "on" ? "🎙️" : p.mic === "muted" ? "🔇" : "❌"}</span>
              </div>
              <div className="w-full truncate text-sm font-bold">{p.name}</div>
              <div className={`text-[11px] font-bold ${p.id === v.hostId ? "text-sun-300" : p.ready ? "text-mint-400" : "text-white/45"}`}>
                {p.id === v.hostId ? t("lobby.host") : p.ready ? `✓ ${t("lobby.isReady")}` : t("lobby.notReady")}
              </div>
            </button>
          ))}
        </div>
      </Card>

      {me && (me.mic === "denied" || me.mic === "off") && <p className="rounded-2xl bg-tang-500/20 p-3 text-center text-sm">🎙️ {t("lobby.noMicSpectator")}</p>}
      {err && <p className="rounded-2xl bg-rose-500/20 p-3 text-center text-sm font-bold">{err}</p>}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {amHost ? (
          <>
            <Button size="lg" onClick={() => void start()} disabled={eligible.length < MIN_PLAYERS} silent>
              ▶ {confirmStart ? t("lobby.startAnyway") : t("lobby.start")}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setShowSettings(true)}>
              ⚙️ {t("lobby.settings")}
            </Button>
          </>
        ) : (
          <>
            <Button size="lg" variant={me?.ready ? "mint" : "grape"} onClick={() => game.emit("room:ready", !me?.ready)}>
              {me?.ready ? t("lobby.unready") : t("lobby.ready")}
            </Button>
            <span className="text-sm text-white/70">{t("lobby.waitHost")}</span>
          </>
        )}
      </div>
      {amHost && eligible.length < MIN_PLAYERS && <p className="text-center text-xs text-white/60">{t("lobby.needTwo")}</p>}

      {showSettings && amHost && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setShowSettings(false)}>
          <div className="safe-bottom max-h-[85dvh] w-full max-w-lg animate-pop overflow-y-auto rounded-t-3xl bg-night-800 p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 font-display text-2xl">⚙️ {t("lobby.settings")}</h2>
            <RoomSettingsForm value={v.settings} onChange={(patch) => void game.action("room:settings", patch)} />
            <Button className="mt-4 w-full" onClick={() => setShowSettings(false)}>
              ✓
            </Button>
          </div>
        </div>
      )}
      {actionFor && <PlayerActions p={actionFor} v={v} onClose={() => setActionFor(null)} />}
    </div>
  );
}
