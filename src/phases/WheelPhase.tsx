// عجلة الحظ: الدوران متزامن على كل الأجهزة (النتيجة يحددها الخادم مسبقًا، والزاوية تُحسب من وقت الخادم)
import { useRef } from "react";
import type { RoomView, WheelOutcome } from "../../shared/types";
import { AvatarFace } from "../components/AvatarFace";
import { useRaf } from "../components/Mic";
import { Button, Card } from "../components/ui";
import { game } from "../game/client";
import type { I18nKey } from "../lib/i18n";
import { useLang } from "../lib/lang";
import { serverNow } from "../lib/clock";
import { sfx } from "../lib/sfx";
import { useRemaining } from "./Round";

const ICONS: Record<WheelOutcome, string> = { plus20: "➕", plus50: "💰", double: "×2", steal: "🦹", shield: "🛡️", swap: "🔄", sabotage: "😈" };
const COLORS = ["#7c3aed", "#2563eb", "#f97316", "#db2777", "#0891b2", "#65a30d"];

function WheelSvg({ v }: { v: RoomView }) {
  const { t } = useLang();
  const w = v.wheel!;
  const g = useRef<SVGGElement>(null);
  const lastSlice = useRef(-1);
  const n = w.slices.length;
  const A = 360 / n;
  const target = w.sliceIndex !== null ? (w.sliceIndex + w.sliceOffset) * A : 0;
  const finalRot = 360 * 6 + (360 - target);
  useRaf(() => {
    let rot: number;
    if (w.stage === "intro" || w.spinAt === null) rot = (performance.now() / 40) % 360;
    else {
      const k = Math.min(1, Math.max(0, (serverNow() - w.spinAt) / w.spinMs));
      rot = finalRot * (1 - (1 - k) ** 4);
    }
    if (g.current) g.current.setAttribute("transform", `rotate(${rot} 150 150)`);
    // صوت «تك» كل ما مرت شريحة تحت المؤشر
    const under = Math.floor((((360 - (rot % 360)) % 360) / A) % n);
    if (w.stage === "spin" && under !== lastSlice.current) {
      lastSlice.current = under;
      sfx("wheelTick");
    }
  });
  return (
    <svg viewBox="0 0 300 320" className="mx-auto w-full max-w-[22rem] drop-shadow-2xl" aria-label={t("phase.wheel")}>
      <g ref={g}>
        {w.slices.map((o, i) => {
          const a0 = ((i * A - 90) * Math.PI) / 180;
          const a1 = (((i + 1) * A - 90) * Math.PI) / 180;
          const mid = (((i + 0.5) * A - 90) * Math.PI) / 180;
          const x0 = 150 + 140 * Math.cos(a0);
          const y0 = 150 + 140 * Math.sin(a0);
          const x1 = 150 + 140 * Math.cos(a1);
          const y1 = 150 + 140 * Math.sin(a1);
          return (
            <g key={i}>
              <path d={`M150 150 L${x0} ${y0} A140 140 0 0 1 ${x1} ${y1} Z`} fill={COLORS[i % COLORS.length]} stroke="#140c33" strokeWidth="3" />
              <text
                x={150 + 98 * Math.cos(mid)}
                y={150 + 98 * Math.sin(mid)}
                fontSize="22"
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${(i + 0.5) * A} ${150 + 98 * Math.cos(mid)} ${150 + 98 * Math.sin(mid)})`}
              >
                {ICONS[o]}
              </text>
            </g>
          );
        })}
        <circle cx="150" cy="150" r="140" fill="none" stroke="#fde047" strokeWidth="6" />
        {Array.from({ length: n }, (_, i) => {
          const a = ((i * A - 90) * Math.PI) / 180;
          return <circle key={i} cx={150 + 140 * Math.cos(a)} cy={150 + 140 * Math.sin(a)} r="5" fill="#fff" />;
        })}
      </g>
      <circle cx="150" cy="150" r="26" fill="#fde047" stroke="#140c33" strokeWidth="4" />
      <text x="150" y="152" textAnchor="middle" dominantBaseline="central" fontSize="22">
        🎡
      </text>
      <path d="M150 34 L136 4 L164 4 Z" fill="#fb7185" stroke="#fff" strokeWidth="3" />
    </svg>
  );
}

export function WheelPhase({ v }: { v: RoomView }) {
  const { t } = useLang();
  const w = v.wheel;
  const pickLeft = useRemaining(w?.pickEndsAt ?? null);
  if (!w) return null;
  const spinner = game.nameOf(w.spinnerId);
  const target = w.targetId ? game.nameOf(w.targetId) : "";
  const isSpinner = w.spinnerId === game.me;
  let result = "";
  if (w.stage === "result" && w.outcome) {
    if (w.blocked) result = t("wheel.res.blocked", { target });
    else if (w.outcome === "plus20" || w.outcome === "plus50") result = t("wheel.res.plus", { name: spinner, n: w.amount });
    else if (w.outcome === "double") result = t("wheel.res.double", { name: spinner });
    else if (w.outcome === "shield") result = t("wheel.res.shield", { name: spinner });
    else if (w.outcome === "steal") result = t("wheel.res.steal", { name: spinner, n: w.amount, target });
    else if (w.outcome === "swap") result = t("wheel.res.swap", { name: spinner, target });
    else result = t("wheel.res.sabotage", { target });
  }
  return (
    <div className="mx-auto w-full max-w-md space-y-2 px-3 text-center">
      <div className="flex items-center justify-center gap-2">
        <AvatarFace avatar={game.avatarOf(w.spinnerId)} size={44} />
        <div className="font-display text-3xl">{t("phase.wheelFor", { name: spinner })}</div>
      </div>
      <WheelSvg v={v} />
      {w.outcome && <div className="animate-pop font-display text-2xl text-sun-300">{t(`wheel.${w.outcome}` as I18nKey)}</div>}
      {w.stage === "pick" &&
        (isSpinner ? (
          <Card className="space-y-2 p-3">
            <div className="font-bold">
              {t("phase.wheelPick")} ({Math.ceil(pickLeft / 1000)})
            </div>
            <div className="grid grid-cols-2 gap-2">
              {v.players
                .filter((p) => p.id !== game.me)
                .map((p) => (
                  <Button key={p.id} size="sm" variant={p.shield ? "ghost" : "danger"} onClick={() => game.emit("wheel:pick", p.id)}>
                    <AvatarFace avatar={p.avatar} size={26} /> {p.name} {p.shield && "🛡️"}
                  </Button>
                ))}
            </div>
          </Card>
        ) : (
          <div className="text-white/80">{t("phase.wheelPicking", { name: spinner })}</div>
        ))}
      {result && <Card className="animate-pop p-3 text-lg font-bold">{result}</Card>}
    </div>
  );
}
