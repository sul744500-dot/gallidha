// مكتبة الأصوات والتدريب الفردي (نفس محرك التقييم الموجود على الخادم)
import { useEffect, useMemo, useState } from "react";
import { SAMPLE_RATE } from "../../shared/constants";
import type { PackInfo, ScoreResult, SoundInfo } from "../../shared/types";
import { resample } from "../../shared/audio/resample";
import { mic } from "../audio/mic";
import { recorder } from "../audio/recorder";
import { loadReference, playAt, stopPlayback } from "../audio/playback";
import { toAudioBuffer, unlockAudio } from "../audio/engine";
import { MicButton, Waveform } from "../components/Mic";
import { ScoreCard } from "../components/ScoreCard";
import { Button, Card, Screen } from "../components/ui";
import { useLang } from "../lib/lang";
import { navigate } from "../lib/router";
import { sfx } from "../lib/sfx";
import { useStore } from "../lib/store";
import { MicErrorPanel } from "./Gate";

let packsCache: Promise<PackInfo[]> | null = null;
export function usePacks(): PackInfo[] | null {
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  useEffect(() => {
    packsCache ??= fetch("/api/packs").then((r) => r.json());
    packsCache.then(setPacks).catch(() => (packsCache = null));
  }, []);
  return packs;
}

export function Library() {
  const { t, lt } = useLang();
  const packs = usePacks();
  const [playing, setPlaying] = useState("");
  const count = packs?.reduce((n, p) => n + p.sounds.length, 0) ?? 0;
  const preview = async (s: SoundInfo) => {
    unlockAudio();
    setPlaying(s.id);
    const h = playAt(await loadReference(s.url), null);
    void h.ended.then(() => setPlaying((x) => (x === s.id ? "" : x)));
  };
  return (
    <Screen title={`🎧 ${t("library.title")}`} onBack={() => (stopPlayback(), navigate({ name: "home" }))} wide>
      <p className="mb-3 text-white/70">
        {t("library.subtitle", { n: count })} — {t("library.license")}
      </p>
      <div className="space-y-4">
        {packs?.map((pack) => (
          <Card key={pack.id} className="p-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="text-4xl">{pack.emoji}</span>
              <div>
                <h2 className="font-display text-2xl">{lt(pack.name)}</h2>
                <p className="text-sm text-white/60">{lt(pack.description)}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {pack.sounds.map((s) => (
                <div key={s.id} className={`flex items-center gap-2 rounded-2xl p-2 ${playing === s.id ? "bg-tang-500/30" : "bg-black/25"}`}>
                  <button type="button" onClick={() => void preview(s)} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10 text-2xl" aria-label={lt(s.name)}>
                    {playing === s.id ? "🔊" : s.emoji}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{lt(s.name)}</div>
                    <div className="text-xs text-white/55">
                      {"⭐".repeat(s.difficulty)} • {(s.durationMs / 1000).toFixed(1)}s
                    </div>
                  </div>
                  <Button size="sm" variant="mint" onClick={() => navigate({ name: "solo", sound: s.id })}>
                    🎯 {t("library.practice")}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </Screen>
  );
}

type Stage = "idle" | "listening" | "countdown" | "recording" | "analyzing" | "done";

export function Solo({ soundId }: { soundId?: string }) {
  const { t, lt } = useLang();
  const packs = usePacks();
  const m = useStore(mic.store);
  const all = useMemo(() => packs?.flatMap((p) => p.sounds) ?? [], [packs]);
  const [sound, setSound] = useState<SoundInfo | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [count, setCount] = useState(3);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [mine, setMine] = useState<Float32Array | null>(null);

  useEffect(() => {
    if (!all.length || sound) return;
    setSound(all.find((s) => s.id === soundId) ?? all[Math.floor(Math.random() * all.length)]);
  }, [all, soundId, sound]);

  const run = async () => {
    if (!sound) return;
    unlockAudio();
    if (!mic.ready) await mic.request();
    if (!mic.ready || !(await recorder.prepare())) return;
    setResult(null);
    setStage("listening");
    const h = playAt(await loadReference(sound.url), null);
    await h.ended;
    setStage("countdown");
    for (let i = 3; i > 0; i--) {
      setCount(i);
      sfx("tick");
      await new Promise((r) => setTimeout(r, 800));
    }
    sfx("go");
    setStage("recording");
    recorder.start();
    const window = Math.round(Math.min(9000, Math.max(3000, sound.durationMs * 1.3 + 1000)));
    await new Promise((r) => setTimeout(r, window));
    const out = await recorder.stop();
    if (!out) return setStage("idle");
    setMine(out.samples16k);
    setStage("analyzing");
    try {
      const res = await fetch(`/api/practice/score?sound=${encodeURIComponent(sound.id)}`, { method: "POST", body: out.wav, headers: { "content-type": "audio/wav" } });
      setResult(out.mutedAll ? { status: "muted", score: null, parts: null } : ((await res.json()) as ScoreResult));
    } catch {
      setResult({ status: "missing", score: null, parts: null });
    }
    setStage("done");
  };

  const busy = stage !== "idle" && stage !== "done";
  return (
    <Screen title={`🎯 ${t("solo.title")}`} onBack={() => (stopPlayback(), recorder.cancel(), navigate({ name: "home" }))}>
      {m.status !== "ready" && m.status !== "idle" && m.status !== "requesting" && <MicErrorPanel status={m.status} onRetry={() => void mic.request()} />}
      <Card className="space-y-4 p-5 text-center">
        {sound && (
          <>
            <div className="text-6xl">{sound.emoji}</div>
            <div className="font-display text-3xl text-sun-300">{lt(sound.name)}</div>
          </>
        )}
        <select
          className="w-full rounded-2xl bg-black/30 p-3"
          value={sound?.id ?? ""}
          disabled={busy}
          onChange={(e) => {
            setSound(all.find((s) => s.id === e.target.value) ?? null);
            setResult(null);
            setStage("idle");
          }}
          aria-label={t("solo.pick")}
        >
          {packs?.map((p) => (
            <optgroup key={p.id} label={lt(p.name)}>
              {p.sounds.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji} {lt(s.name)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {stage === "listening" && <div className="font-display text-2xl">🔊 {t("phase.listen")}</div>}
        {stage === "countdown" && <div className="countdown-num font-display text-8xl text-sun-300" key={count}>{count}</div>}
        {stage === "recording" && (
          <div className="space-y-2">
            <div className="font-display text-3xl text-rose-300">● {t("phase.record")}</div>
            <Waveform />
          </div>
        )}
        {stage === "analyzing" && <div className="font-display text-2xl">🧪 {t("solo.analyzing")}</div>}
        {result && stage === "done" && (
          <ScoreCard entry={{ playerId: "me", status: result.status, score: result.score, parts: result.parts, multiplier: 1, points: result.score ?? 0, votes: 0, voteBonus: 0, sabotage: null, durationMs: 0, playMs: 0 }} />
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={() => void run()} disabled={busy || !sound}>
            ⏺ {stage === "done" ? t("solo.again") : t("solo.record")}
          </Button>
          {sound && !busy && (
            <Button size="lg" variant="ghost" onClick={() => void loadReference(sound.url).then((b) => playAt(b, null))}>
              ▶ {t("solo.original")}
            </Button>
          )}
          {mine && !busy && (
            <Button size="lg" variant="azure" onClick={() => playAt(toAudioBuffer(mine, SAMPLE_RATE, resample), null)}>
              ▶ {t("solo.yours")}
            </Button>
          )}
          {!busy && all.length > 1 && (
            <Button
              size="lg"
              variant="ghost"
              onClick={() => {
                setSound(all[Math.floor(Math.random() * all.length)]);
                setResult(null);
                setStage("idle");
              }}
            >
              🎲 {t("solo.random")}
            </Button>
          )}
        </div>
        <div className="flex justify-center">
          <MicButton inRoom={false} size={56} />
        </div>
        <p className="text-xs text-white/50">🧪 {t("score.method")}</p>
      </Card>
    </Screen>
  );
}
