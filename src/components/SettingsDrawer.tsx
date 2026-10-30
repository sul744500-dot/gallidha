// لوحة الإعدادات: مستويات الصوت، المايك وأجهزته، اللغة، الحركة، الرسوميات، معلومات الاتصال
import { useEffect, useState } from "react";
import { mic } from "../audio/mic";
import { voice } from "../audio/voice";
import { outputSelectable, setOutputDevice } from "../audio/engine";
import { game } from "../game/client";
import { useLang } from "../lib/lang";
import { prefs, setPref, type Graphics } from "../lib/prefs";
import { createStore, useStore } from "../lib/store";
import { DeviceSelect } from "../screens/MicCheck";
import { LevelMeter, MicButton } from "./Mic";
import { Button, Field, inputClass, Segmented, Slider, Toggle } from "./ui";

const open = createStore(false);
export const openSettings = () => open.set(true);

function OutputSelect() {
  const { t } = useLang();
  const [outs, setOuts] = useState<MediaDeviceInfo[]>([]);
  const [sel, setSel] = useState("");
  const supported = outputSelectable();
  useEffect(() => {
    if (!supported) return;
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((l) => setOuts(l.filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default")))
      .catch(() => {});
  }, [supported]);
  if (!supported) return <p className="text-xs text-white/50">🔈 {t("settings.outputUnsupported")}</p>;
  if (!outs.length) return null;
  return (
    <Field label={t("settings.output")}>
      <select
        className={inputClass}
        value={sel}
        onChange={(e) => {
          setSel(e.target.value);
          void setOutputDevice(e.target.value);
        }}
      >
        <option value="">{t("check.default")}</option>
        {outs.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId.slice(0, 8)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ConnectionInfo() {
  const { t } = useLang();
  const g = useStore(game.store);
  const v = useStore(voice.store);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const rtt = game.rtt();
  return (
    <div className="space-y-1 rounded-2xl bg-black/25 p-3 text-sm">
      <div className="flex justify-between">
        <span>{t("settings.server")}</span>
        <b className={g.conn === "connected" ? "text-mint-400" : "text-tang-300"}>{g.conn === "connected" ? "✓" : t("status.reconnecting")}</b>
      </div>
      <div className="flex justify-between">
        <span>{t("settings.ping")}</span>
        <b dir="ltr">{Number.isFinite(rtt) ? `${Math.round(rtt)} ms` : "—"}</b>
      </div>
      {g.view && (
        <div>
          <div className="mb-1">{t("settings.peers")}</div>
          {!v.enabled && <div className="text-white/50">{t("settings.peer.disabled")}</div>}
          {v.enabled &&
            Object.entries(v.peers).map(([id, st]) => (
              <div key={id} className="flex justify-between text-xs">
                <span>{game.nameOf(id)}</span>
                <span className={st === "connected" ? "text-mint-400" : st === "failed" ? "text-rose-300" : "text-white/60"}>{t(`settings.peer.${st}`)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function SettingsDrawer() {
  const isOpen = useStore(open);
  const { t } = useLang();
  const p = useStore(prefs);
  const m = useStore(mic.store);
  const inRoom = !!useStore(game.store).view;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && open.set(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);
  if (!isOpen) return null;
  const standalone = matchMedia("(display-mode: standalone)").matches;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={() => open.set(false)}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        onClick={(e) => e.stopPropagation()}
        className="safe-top safe-bottom h-full w-full max-w-md animate-pop overflow-y-auto bg-night-800/95 p-5 shadow-2xl scroll-thin"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-3xl">⚙️ {t("settings.title")}</h2>
          <Button size="sm" variant="ghost" onClick={() => open.set(false)}>
            ✕ {t("settings.close")}
          </Button>
        </div>
        <section className="space-y-2">
          <Slider label={t("settings.othersVolume")} icon="🗣️" value={p.othersVolume} onChange={(v) => setPref("othersVolume", v)} />
          <Slider label={t("settings.gameVolume")} icon="🔊" value={p.gameVolume} onChange={(v) => setPref("gameVolume", v)} />
          <Slider label={t("settings.sfxVolume")} icon="✨" value={p.sfxVolume} onChange={(v) => setPref("sfxVolume", v)} />
        </section>
        <section className="mt-5 space-y-3">
          <h3 className="font-display text-xl">🎙️ {t("settings.mic")}</h3>
          <div className="flex items-center gap-4">
            <MicButton inRoom={inRoom} size={64} />
            <LevelMeter bars={16} className="h-12 flex-1" />
          </div>
          <DeviceSelect />
          <OutputSelect />
          <Toggle checked={m.raw} onChange={(v) => void mic.setRaw(v)} label={t("settings.raw")} hint={t("settings.rawHint")} />
          {m.status === "ready" && !inRoom && (
            <Button size="sm" variant="ghost" onClick={() => mic.stop()}>
              ⏹ {t("settings.stopMic")}
            </Button>
          )}
        </section>
        <section className="mt-5 space-y-3">
          <Field label={t("settings.lang")}>
            <Segmented
              value={p.lang}
              onChange={(v) => setPref("lang", v)}
              options={[
                { value: "ar", label: "العربية" },
                { value: "en", label: "English" },
              ]}
            />
          </Field>
          <Field label={t("settings.graphics")}>
            <Segmented<Graphics>
              value={p.graphics}
              onChange={(v) => setPref("graphics", v)}
              options={[
                { value: "high", label: t("settings.graphics.high") },
                { value: "low", label: t("settings.graphics.low") },
                { value: "off", label: t("settings.graphics.off") },
              ]}
            />
          </Field>
          <Toggle checked={p.reduceMotion} onChange={(v) => setPref("reduceMotion", v)} label={t("settings.reduceMotion")} />
        </section>
        <section className="mt-5 space-y-2">
          <h3 className="font-display text-xl">📡 {t("settings.connection")}</h3>
          <ConnectionInfo />
        </section>
        {!standalone && (
          <section className="mt-5 rounded-2xl bg-black/25 p-3 text-sm text-white/75">
            📲 {t("settings.install")}
            <div className="text-xs text-white/55">{t("settings.installIos")}</div>
          </section>
        )}
      </aside>
    </div>
  );
}

export function Toasts() {
  const { t } = useLang();
  const list = useStore(game.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {list.map((x) => (
        <div key={x.id} className="animate-pop rounded-full bg-night-700/95 px-4 py-2 text-sm font-bold shadow-lg ring-1 ring-white/15">
          {t(x.key as Parameters<typeof t>[0], x.vars)}
        </div>
      ))}
    </div>
  );
}
