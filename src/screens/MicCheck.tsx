// اختبار المايك بعد الموافقة: مؤشر مستوى، تسجيل قصير محلي واستماع، واختيار الجهاز
import { useRef, useState } from "react";
import { resample } from "../../shared/audio/resample";
import { SAMPLE_RATE } from "../../shared/constants";
import { mic } from "../audio/mic";
import { recorder } from "../audio/recorder";
import { playAt } from "../audio/playback";
import { toAudioBuffer } from "../audio/engine";
import { LevelMeter, MicButton, useRaf } from "../components/Mic";
import { Button, Card, Field, inputClass, Toggle } from "../components/ui";
import { useLang } from "../lib/lang";
import { useStore } from "../lib/store";
import { MicErrorPanel } from "./Gate";

export function DeviceSelect() {
  const { t } = useLang();
  const m = useStore(mic.store);
  if (m.devices.length < 2) return null;
  return (
    <Field label={t("check.device")}>
      <select className={inputClass} value={m.deviceId} onChange={(e) => void mic.selectDevice(e.target.value)}>
        <option value="">{t("check.default")}</option>
        {m.devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function MicCheck({ onDone }: { onDone: () => void }) {
  const { t } = useLang();
  const m = useStore(mic.store);
  const [heard, setHeard] = useState(false);
  const [rec, setRec] = useState<{ samples: Float32Array } | null>(null);
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useRaf(() => {
    if (!heard && mic.level() > 0.3) setHeard(true);
  });

  const testRecord = async () => {
    if (!(await recorder.prepare())) return;
    recorder.start();
    setLeft(3);
    let n = 3;
    timer.current = setInterval(async () => {
      n--;
      setLeft(n);
      if (n <= 0) {
        clearInterval(timer.current!);
        const out = await recorder.stop();
        if (out) setRec({ samples: out.samples16k });
      }
    }, 1000);
  };

  if (m.status !== "ready") {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <MicErrorPanel status={m.status} onRetry={() => void mic.request()} onSkip={onDone} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
      <h1 className="text-center font-display text-4xl">{t("check.title")} 🎙️</h1>
      <Card className="space-y-4 p-5 text-center">
        <p className="text-lg">{t("check.say")}</p>
        <LevelMeter />
        <p className={`font-bold ${heard ? "text-mint-400" : "text-white/60"}`}>{heard ? t("check.heard") : t("check.notHeard")}</p>
        <div className="flex justify-center">
          <MicButton inRoom={false} />
        </div>
      </Card>
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="grape" onClick={() => void testRecord()} disabled={left > 0}>
            ⏺ {left > 0 ? t("check.recording", { s: left }) : t("check.testRec")}
          </Button>
          {rec && (
            <Button variant="azure" onClick={() => playAt(toAudioBuffer(rec.samples, SAMPLE_RATE, resample), null)}>
              ▶ {t("check.play")}
            </Button>
          )}
        </div>
        <p className="text-xs text-white/55">🔒 {t("check.local")}</p>
        <DeviceSelect />
        <Toggle checked={m.raw} onChange={(v) => void mic.setRaw(v)} label={t("settings.raw")} hint={t("settings.rawHint")} />
      </Card>
      <p className="text-center text-sm text-white/70">{t("gate.headphones")}</p>
      <Button size="lg" className="w-full" onClick={onDone}>
        {t("check.continue")} ✓
      </Button>
    </div>
  );
}
