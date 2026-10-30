// شاشة الغرفة: المرحلة الحالية + شريط اللاعبين + زر المايك الكبير (لا يغطيه شيء)
import { useEffect } from "react";
import type { RoomView } from "../../shared/types";
import { MicButton } from "../components/Mic";
import { PlayerChip } from "../components/PlayerChip";
import { Button } from "../components/ui";
import { director } from "../game/director";
import { game } from "../game/client";
import { useLang } from "../lib/lang";
import { navigate } from "../lib/router";
import { useStore } from "../lib/store";
import { Final } from "../phases/Final";
import { Lobby } from "../phases/Lobby";
import { Leaderboard, Reveal, Vote } from "../phases/Reveal";
import { Collect, Countdown, Intro, Listen, Record } from "../phases/Round";
import { WheelPhase } from "../phases/WheelPhase";

function Phase({ v }: { v: RoomView }) {
  switch (v.phase) {
    case "lobby":
      return <Lobby v={v} />;
    case "intro":
      return <Intro v={v} />;
    case "listen":
      return <Listen v={v} />;
    case "countdown":
      return <Countdown v={v} />;
    case "record":
      return <Record v={v} />;
    case "collect":
      return <Collect v={v} />;
    case "reveal":
      return <Reveal v={v} />;
    case "vote":
      return <Vote v={v} />;
    case "leaderboard":
      return <Leaderboard v={v} />;
    case "wheel":
      return <WheelPhase v={v} />;
    case "final":
      return <Final v={v} />;
  }
}

export function RoomScreen({ code }: { code: string }) {
  const { t } = useLang();
  const g = useStore(game.store);
  const d = useStore(director);
  const v = g.view;

  // فتح رابط غرفة بدون جلسة: نحاول الاستئناف، وإلا نرجع لشاشة الانضمام
  useEffect(() => {
    if (g.view || g.code === code) return;
    if (game.savedCode() === code) void game.resume().then((r) => r && !r.ok && navigate({ name: "join", code }, true));
    else navigate({ name: "join", code }, true);
  }, [code, g.view, g.code]);

  if (!v) return <div className="grid h-full place-items-center text-white/70">{t("status.connecting")}</div>;

  const inMatch = v.phase !== "lobby";
  const playing = d.playingId;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col overflow-y-auto pb-2 pt-1 scroll-thin">
        <div key={`${v.phase}:${v.round}:${v.reveal?.index ?? ""}`} className="my-auto w-full animate-pop">
          <Phase v={v} />
        </div>
      </div>
      <div className="safe-bottom shrink-0 border-t border-white/10 bg-night-900/70 px-2 pt-2 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-end gap-2">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 scroll-thin">
            {v.players.map((p) => (
              <PlayerChip key={p.id} p={p} me={p.id === g.me} host={p.id === v.hostId} compact showReady={!inMatch} highlight={playing === p.id || v.reveal?.current?.playerId === p.id} />
            ))}
          </div>
          <div className="shrink-0 pb-1">
            <MicButton size={68} />
          </div>
        </div>
        {v.phase === "lobby" && (
          <div className="mx-auto mt-1 flex max-w-4xl justify-start">
            <Button size="sm" variant="ghost" onClick={() => (game.leave(), navigate({ name: "home" }, true))}>
              🚪 {t("lobby.leave")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
