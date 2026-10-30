// شاشة الترحيب وطلب صلاحية المايك الحقيقية (بدون كاميرا)
import { useState } from "react";
import { mic, type MicStatus } from "../audio/mic";
import { unlockAudio } from "../audio/engine";
import { Logo } from "../components/Logo";
import { Button, Card } from "../components/ui";
import { useLang } from "../lib/lang";
import { useStore } from "../lib/store";
import type { I18nKey } from "../lib/i18n";
import { sfx } from "../lib/sfx";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function MicErrorPanel({ status, onRetry, onSkip }: { status: MicStatus; onRetry: () => void; onSkip?: () => void }) {
  const { t } = useLang();
  const m = useStore(mic.store);
  const key = (["denied", "notfound", "busy", "insecure", "unsupported", "ended"].includes(status) ? status : "error") as "denied";
  const permanentlyDenied = status === "denied" && m.permission === "denied";
  return (
    <Card className="animate-pop space-y-3 p-5 text-start">
      <div className="flex items-center gap-3">
        <span className="text-4xl">{status === "denied" ? "🙅" : status === "busy" ? "📞" : status === "insecure" ? "🔓" : "🎤"}</span>
        <h2 className="font-display text-2xl">{t(`gate.err.${key}.title` as I18nKey)}</h2>
      </div>
      <p className="text-white/85">{t(`gate.err.${key}.body` as I18nKey)}</p>
      {status === "denied" && <p className="rounded-2xl bg-black/25 p-3 text-sm text-white/80">{isIOS() ? t("gate.err.denied.ios") : t("gate.err.denied.other")}</p>}
      {status === "insecure" && <p className="rounded-2xl bg-black/25 p-3 text-sm" dir="ltr">{`https://${location.hostname}${location.port === "3200" ? ":3443" : ""}`}</p>}
      {m.errorName && <p className="text-xs text-white/45">{t("gate.errorCode", { name: "" })}<bdi dir="ltr">{m.errorName}</bdi></p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {status !== "insecure" && status !== "unsupported" && (
          <Button onClick={onRetry} variant="primary">
            {t("gate.retry")}
          </Button>
        )}
        {onSkip && (
          <Button onClick={onSkip} variant="ghost">
            {t("gate.watchOnly")}
          </Button>
        )}
      </div>
      {permanentlyDenied && <p className="text-xs text-white/50">⚠️ {t("gate.err.denied.saved")}</p>}
    </Card>
  );
}

export function Gate({ onDone, rejoinCode }: { onDone: (granted: boolean) => void; rejoinCode: string | null }) {
  const { t } = useLang();
  const m = useStore(mic.store);
  const [tried, setTried] = useState(false);

  const start = async () => {
    // داخل ضغطة اللاعب: نفتح الصوت (iOS) ثم نطلب المايك من نافذة المتصفح/النظام الحقيقية
    unlockAudio();
    setTried(true);
    const status = await mic.request();
    if (status === "ready") {
      sfx("join");
      onDone(true);
    } else sfx("error");
  };

  const failed = tried && m.status !== "ready" && m.status !== "requesting" && m.status !== "idle";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col items-center justify-center gap-6 px-5 py-10 text-center">
      <div className="animate-float">
        <Logo size="lg" />
      </div>
      <p className="max-w-sm text-lg text-white/85">{t("app.tagline")}</p>
      {!failed && (
        <>
          <Button size="xl" onClick={() => void start()} disabled={m.status === "requesting"} className="w-full max-w-sm" silent>
            🎙️ {m.status === "requesting" ? t("gate.requesting") : rejoinCode ? `${t("gate.start")}` : t("gate.start")}
          </Button>
          {rejoinCode && <div className="rounded-full bg-white/10 px-4 py-1 text-sm">{t("gate.rejoin", { code: rejoinCode })}</div>}
        </>
      )}
      {failed && <MicErrorPanel status={m.status} onRetry={() => void start()} onSkip={() => onDone(false)} />}
      <div className="glass max-w-sm space-y-2 rounded-3xl p-4 text-sm text-white/75">
        <p>🔒 {t("gate.privacy")}</p>
        <p>{t("gate.headphones")}</p>
      </div>
    </div>
  );
}
