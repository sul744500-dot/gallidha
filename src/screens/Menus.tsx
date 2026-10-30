// الشاشة الرئيسية، إنشاء غرفة، الانضمام، وكيف تلعب
import { useState } from "react";
import { MAX_PLAYERS, MIN_PLAYERS, RECORD_CHOICES, ROUND_CHOICES } from "../../shared/constants";
import { CATEGORIES, DEFAULT_SETTINGS, MODES } from "../../shared/game";
import type { Category, GameMode, RecordChoice, RoomSettings, RoundChoice } from "../../shared/types";
import { mic } from "../audio/mic";
import { unlockAudio } from "../audio/engine";
import { Logo } from "../components/Logo";
import { ProfileForm } from "../components/ProfileForm";
import { Button, Card, Field, inputClass, Screen, Segmented, Toggle } from "../components/ui";
import { game } from "../game/client";
import type { I18nKey } from "../lib/i18n";
import { useLang } from "../lib/lang";
import { prefs, setPref } from "../lib/prefs";
import { navigate } from "../lib/router";
import { sfx } from "../lib/sfx";
import { useStore } from "../lib/store";
import { openSettings } from "../components/SettingsDrawer";

export function Home() {
  const { t } = useLang();
  const m = useStore(mic.store);
  const pr = useStore(prefs);
  const [busy, setBusy] = useState(false);
  /** «العب الآن»: غرفة بالإعدادات الافتراضية بضغطة وحدة (إذا الاسم محفوظ) */
  const quickPlay = async () => {
    if (!pr.name.trim()) return navigate({ name: "create" });
    setBusy(true);
    await ensureMic();
    const r = await game.create("", pr.name, pr.avatar, DEFAULT_SETTINGS);
    setBusy(false);
    if (r.ok) navigate({ name: "room", code: r.code }, true);
    else navigate({ name: "create" });
  };
  const items: { label: string; icon: string; variant: "primary" | "grape" | "azure" | "ghost" | "mint"; go: () => void; big?: boolean }[] = [
    { label: t("home.play"), icon: "🎤", variant: "primary", go: () => void quickPlay(), big: true },
    { label: t("home.create"), icon: "🏠", variant: "grape", go: () => navigate({ name: "create" }) },
    { label: t("home.join"), icon: "🔑", variant: "azure", go: () => navigate({ name: "join" }) },
    { label: t("home.solo"), icon: "🎯", variant: "mint", go: () => navigate({ name: "solo" }) },
    { label: t("home.library"), icon: "🎧", variant: "ghost", go: () => navigate({ name: "library" }) },
    { label: t("home.how"), icon: "❓", variant: "ghost", go: () => navigate({ name: "how" }) },
    { label: t("home.settings"), icon: "⚙️", variant: "ghost", go: openSettings },
  ];
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 px-4 pb-10 pt-2">
      <div className="animate-float py-2">
        <Logo size="lg" />
      </div>
      {m.status !== "ready" && <div className="rounded-full bg-white/10 px-4 py-1.5 text-xs text-white/75">🎙️ {t("home.micOff")}</div>}
      <div className="grid w-full grid-cols-2 gap-3">
        {items.map((it, i) => (
          <Button key={i} variant={it.variant} size={it.big ? "xl" : "lg"} onClick={it.go} disabled={busy && it.big} className={`${it.big ? "col-span-2" : ""} animate-pop`} style={{ animationDelay: `${i * 50}ms` }}>
            <span className="text-2xl">{it.icon}</span> {it.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function errorKey(e: string): I18nKey {
  return (`join.err.${["not_found", "full", "kicked", "bad_name", "bad_request", "rate_limited", "expired"].includes(e) ? e : "network"}`) as I18nKey;
}

/** نضمن تشغيل المايك قبل دخول الغرفة (قد يكون أُوقف عند مغادرة غرفة سابقة) */
async function ensureMic() {
  unlockAudio();
  if (mic.snap.status !== "denied" && !mic.ready) await mic.request();
}

export function CreateRoom() {
  const { t } = useLang();
  const p = useStore(prefs);
  const [roomName, setRoomName] = useState("");
  const [s, setS] = useState<RoomSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const up = (patch: Partial<RoomSettings>) => setS((x) => ({ ...x, ...patch }));

  const submit = async () => {
    if (!p.name.trim()) return setError(t("join.err.bad_name"));
    setBusy(true);
    setError("");
    await ensureMic();
    const r = await game.create(roomName, p.name, p.avatar, s);
    setBusy(false);
    if (r.ok) {
      sfx("join");
      navigate({ name: "room", code: r.code }, true);
    } else {
      sfx("error");
      setError(t(errorKey(r.error)));
    }
  };

  return (
    <Screen title={t("create.title")} onBack={() => navigate({ name: "home" })}>
      <div className="space-y-4">
        <Card className="p-5">
          <ProfileForm name={p.name} avatar={p.avatar} onName={(v) => setPref("name", v)} onAvatar={(a) => setPref("avatar", a)} />
        </Card>
        <Card className="space-y-4 p-5">
          <Field label={t("create.roomName")}>
            <input className={inputClass} value={roomName} maxLength={40} placeholder={t("create.roomNamePh")} onChange={(e) => setRoomName(e.target.value)} />
          </Field>
          <RoomSettingsForm value={s} onChange={up} />
        </Card>
        {error && <p className="rounded-2xl bg-rose-500/20 p-3 text-center font-bold text-rose-200">{error}</p>}
        <Button size="xl" className="w-full" onClick={() => void submit()} disabled={busy}>
          🏠 {t("create.submit")}
        </Button>
      </div>
    </Screen>
  );
}

export function RoomSettingsForm({ value: s, onChange: up, disabled }: { value: RoomSettings; onChange: (p: Partial<RoomSettings>) => void; disabled?: boolean }) {
  const { t } = useLang();
  return (
    <div className="space-y-4">
      <Field label={t("create.mode")}>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((m: GameMode) => (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => {
                sfx("click");
                up({ mode: m });
              }}
              className={`rounded-2xl p-3 text-start transition ${s.mode === m ? "bg-white text-night-900" : "bg-black/25 hover:bg-white/10"} ${disabled ? "opacity-60" : ""}`}
            >
              <div className="font-bold">{t(`mode.${m}` as I18nKey)}</div>
              <div className={`text-xs ${s.mode === m ? "text-night-700" : "text-white/60"}`}>{t(`mode.${m}.d` as I18nKey)}</div>
            </button>
          ))}
        </div>
      </Field>
      <Field label={`${t("create.maxPlayers")}: ${s.maxPlayers}`}>
        <input type="range" min={MIN_PLAYERS} max={MAX_PLAYERS} value={s.maxPlayers} disabled={disabled} onChange={(e) => up({ maxPlayers: Number(e.target.value) })} className="w-full" />
      </Field>
      <Field label={t("create.rounds")}>
        <Segmented<RoundChoice> value={s.rounds} disabled={disabled} onChange={(v) => up({ rounds: v })} options={ROUND_CHOICES.map((n) => ({ value: n, label: String(n) }))} />
      </Field>
      <Field label={t("create.record")}>
        <Segmented<RecordChoice>
          value={s.recordSeconds}
          disabled={disabled}
          onChange={(v) => up({ recordSeconds: v })}
          options={RECORD_CHOICES.map((n) => ({ value: n, label: n === "auto" ? t("create.recordAuto") : t("create.seconds", { n }) }))}
        />
      </Field>
      {s.mode !== "saudi" && s.mode !== "hard" && (
        <Field label={t("create.categories")}>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c: Category) => {
              const on = s.categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() => {
                    sfx("click");
                    const next = on ? s.categories.filter((x) => x !== c) : [...s.categories, c];
                    if (next.length) up({ categories: next });
                  }}
                  className={`min-h-10 rounded-full px-4 text-sm font-bold transition ${on ? "bg-tang-500 text-white" : "bg-black/25 text-white/70"}`}
                >
                  {on ? "✓ " : ""}
                  {t(`cat.${c}` as I18nKey)}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      <Field label={t("create.order")}>
        <Segmented
          value={s.revealOrder}
          disabled={disabled}
          onChange={(v) => up({ revealOrder: v })}
          options={[
            { value: "random", label: t("create.orderRandom") },
            { value: "fixed", label: t("create.orderFixed") },
          ]}
        />
      </Field>
      <Toggle checked={s.wheel} disabled={disabled} onChange={(v) => up({ wheel: v })} label={`🎡 ${t("create.wheel")}`} />
      <Toggle checked={s.voiceChat} disabled={disabled} onChange={(v) => up({ voiceChat: v })} label={`🗣️ ${t("create.voice")}`} hint={t("create.voiceHint")} />
    </div>
  );
}

export function JoinRoom({ code: initial }: { code?: string }) {
  const { t } = useLang();
  const p = useStore(prefs);
  const [code, setCode] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    const c = code.replace(/\D/g, "");
    if (c.length !== 6) return setError(t("join.err.bad_request"));
    if (!p.name.trim()) return setError(t("join.err.bad_name"));
    setBusy(true);
    setError("");
    await ensureMic();
    const r = await game.join(c, p.name, p.avatar);
    setBusy(false);
    if (r.ok) {
      sfx("join");
      navigate({ name: "room", code: r.code }, true);
    } else {
      sfx("error");
      setError(t(errorKey(r.error)));
    }
  };
  return (
    <Screen title={t("join.title")} onBack={() => navigate({ name: "home" })}>
      <div className="space-y-4">
        <Card className="p-5">
          <Field label={t("join.code")}>
            <input
              className={`${inputClass} text-center font-display text-4xl tracking-[0.4em]`}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              value={code}
              placeholder="······"
              onChange={(e) => setCode(e.target.value.replace(/[^\d٠-٩]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))))}
            />
          </Field>
        </Card>
        <Card className="p-5">
          <ProfileForm name={p.name} avatar={p.avatar} onName={(v) => setPref("name", v)} onAvatar={(a) => setPref("avatar", a)} />
        </Card>
        {error && <p className="rounded-2xl bg-rose-500/20 p-3 text-center font-bold text-rose-200">{error}</p>}
        <Button size="xl" variant="azure" className="w-full" onClick={() => void submit()} disabled={busy}>
          🔑 {t("join.submit")}
        </Button>
      </div>
    </Screen>
  );
}

export function HowToPlay() {
  const { t } = useLang();
  const steps: [string, I18nKey][] = [
    ["🏠", "how.1"],
    ["🔊", "how.2"],
    ["⏺", "how.3"],
    ["💯", "how.4"],
    ["🎡", "how.5"],
    ["🏆", "how.6"],
  ];
  return (
    <Screen title={t("how.title")} onBack={() => navigate({ name: "home" })}>
      <div className="space-y-3">
        {steps.map(([icon, key], i) => (
          <Card key={key} className="flex animate-pop items-center gap-4 p-4" >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-grape-500 to-grape-700 text-3xl">{icon}</span>
            <span className="text-lg">
              <b className="font-display text-tang-300">{i + 1}. </b>
              {t(key)}
            </span>
          </Card>
        ))}
        <Card className="space-y-2 p-4 text-sm text-white/80">
          <p>🎧 {t("how.tips")}</p>
          <p>🔒 {t("how.privacy")}</p>
          <p>🧪 {t("score.method")}</p>
        </Card>
      </div>
    </Screen>
  );
}
