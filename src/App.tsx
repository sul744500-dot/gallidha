import { lazy, Suspense, useEffect, useState } from "react";
import { mic } from "./audio/mic";
import { Logo } from "./components/Logo";
import { MicPill } from "./components/Mic";
import { openSettings, SettingsDrawer, Toasts } from "./components/SettingsDrawer";
import { IconButton } from "./components/ui";
import { game } from "./game/client";
import { LangProvider, useLang } from "./lib/lang";
import { prefs, sessionPref } from "./lib/prefs";
import { navigate, route } from "./lib/router";
import { useStore } from "./lib/store";
import { Gate } from "./screens/Gate";
import { Library, Solo } from "./screens/Library";
import { CreateRoom, Home, HowToPlay, JoinRoom } from "./screens/Menus";
import { MicCheck } from "./screens/MicCheck";
import { RoomScreen } from "./screens/RoomScreen";

const Stage3D = lazy(() => import("./three/Stage"));

function TopBar() {
  const { t } = useLang();
  const g = useStore(game.store);
  const v = g.view;
  const inMatch = !!v && v.phase !== "lobby";
  return (
    <header className="safe-top relative z-20 flex shrink-0 items-center gap-2 px-3 pb-2">
      <button type="button" onClick={() => !v && navigate({ name: "home" })} className={`shrink-0 ${v ? "hidden sm:block" : ""}`} aria-label={t("app.name")}>
        <Logo size="sm" />
      </button>
      {v && (
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-black/30 px-3 py-1 text-xs font-bold">
          <span dir="ltr" className="font-display text-sm tracking-widest text-sun-300">
            {v.code}
          </span>
          {inMatch && v.round > 0 && <span className="whitespace-nowrap text-white/70">• {v.round}/{v.totalRounds}</span>}
        </div>
      )}
      <div className="flex-1" />
      <MicPill inRoom={!!v} onClick={openSettings} />
      <IconButton label={t("home.settings")} onClick={openSettings}>
        ⚙️
      </IconButton>
      {v && inMatch && (
        <IconButton
          label={t("lobby.leave")}
          onClick={() => {
            if (window.confirm(`${t("lobby.leave")}?`)) {
              game.leave();
              navigate({ name: "home" }, true);
            }
          }}
        >
          🚪
        </IconButton>
      )}
    </header>
  );
}

function ConnBanner() {
  const { t } = useLang();
  const g = useStore(game.store);
  if (!g.view || g.conn === "connected") return null;
  return <div className="fixed inset-x-0 top-0 z-[70] bg-tang-600 py-1 text-center text-sm font-bold">{t("status.reconnecting")}</div>;
}

function Shell() {
  const r = useStore(route);
  const g = useStore(game.store);
  const p = useStore(prefs);
  const rejoin = game.savedCode();
  const [stage, setStage] = useState<"gate" | "check" | "app">("gate");

  const afterGate = (granted: boolean) => {
    game.ensureSocket();
    if (rejoin) {
      navigate({ name: "room", code: rejoin }, true);
      setStage("app");
    } else if (granted && !sessionPref.get("checked")) setStage("check");
    else setStage("app");
  };

  // الدخول للغرفة ينقلنا لشاشتها تلقائيًا (بعد إنشاء/انضمام/استئناف)
  useEffect(() => {
    if (g.view && !(r.name === "room" && r.code === g.view.code)) navigate({ name: "room", code: g.view.code }, true);
    if (!g.view && r.name === "room" && stage === "app" && !game.savedCode()) navigate({ name: "home" }, true);
  }, [g.view?.code, g.view, r, stage]);

  // إغلاق الصفحة = إيقاف المايك (لا تسجيل في الخلفية)
  useEffect(() => {
    const off = () => mic.stop();
    window.addEventListener("pagehide", off);
    return () => window.removeEventListener("pagehide", off);
  }, []);

  const inRoom = stage === "app" && !!g.view;
  const stageMode = inRoom ? "room" : "showcase";
  let content;
  if (stage === "gate") content = <Gate onDone={afterGate} rejoinCode={rejoin} />;
  else if (stage === "check")
    content = (
      <MicCheck
        onDone={() => {
          sessionPref.set("checked", true);
          setStage("app");
        }}
      />
    );
  else {
    switch (r.name) {
      case "create":
        content = <CreateRoom />;
        break;
      case "join":
        content = <JoinRoom code={r.code} />;
        break;
      case "how":
        content = <HowToPlay />;
        break;
      case "library":
        content = <Library />;
        break;
      case "solo":
        content = <Solo soundId={r.sound} />;
        break;
      case "room":
        content = <RoomScreen code={r.code} />;
        break;
      default:
        content = <Home />;
    }
  }
  const show3d = p.graphics !== "off";
  return (
    <div className={`relative h-[100dvh] overflow-hidden ${p.reduceMotion ? "reduce-motion" : ""}`} style={{ ["--stage-h" as string]: inRoom && show3d ? "clamp(150px, 34dvh, 420px)" : "0px" }}>
      {show3d && (
        <Suspense fallback={null}>
          <Stage3D mode={stageMode} />
        </Suspense>
      )}
      <div className="relative z-10 flex h-full flex-col">
        {stage === "app" && <TopBar />}
        {inRoom && <div className="pointer-events-none shrink-0" style={{ height: "calc(var(--stage-h) - 52px)" }} />}
        <main className={`min-h-0 flex-1 ${inRoom ? "" : "overflow-y-auto scroll-thin"} ${stage === "app" && !inRoom ? "pt-2" : ""}`}>{content}</main>
      </div>
      <Toasts />
      <SettingsDrawer />
      <ConnBanner />
    </div>
  );
}

export function App() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}
