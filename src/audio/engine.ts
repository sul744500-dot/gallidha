// سياق الصوت الموحّد (Web Audio) ومساراته: الأصدقاء، اللعبة (المرجع والتسجيلات)، المؤثرات.
// على iOS لازم يُفتح السياق بضغطة من اللاعب، وقد يتوقف عند مكالمة أو الخروج من التطبيق — نعيد تشغيله بأول لمسة.

import { prefs, type Prefs } from "../lib/prefs";
import { createStore } from "../lib/store";

type CtxWithSink = AudioContext & { setSinkId?: (id: string | { type: "none" }) => Promise<void> };

let ctx: CtxWithSink | null = null;
let buses: { master: GainNode; voice: GainNode; game: GainNode; sfx: GainNode } | null = null;

export const audioState = createStore<{ state: string }>({ state: "none" });

function applyVolumes(p: Prefs) {
  if (!buses || !ctx) return;
  const t = ctx.currentTime;
  buses.voice.gain.setTargetAtTime(p.othersVolume, t, 0.05);
  buses.game.gain.setTargetAtTime(p.gameVolume, t, 0.05);
  buses.sfx.gain.setTargetAtTime(p.sfxVolume * 0.8, t, 0.05);
}

export function getCtx(): CtxWithSink {
  if (!ctx) {
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" }) as CtxWithSink;
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    buses = { master, voice: ctx.createGain(), game: ctx.createGain(), sfx: ctx.createGain() };
    buses.voice.connect(master);
    buses.game.connect(master);
    buses.sfx.connect(master);
    applyVolumes(prefs.get());
    prefs.subscribe(() => applyVolumes(prefs.get()));
    ctx.onstatechange = () => audioState.set({ state: ctx!.state });
    audioState.set({ state: ctx.state });
    // إعادة التشغيل بعد مقاطعة (مكالمة/خلفية) عند أول تفاعل
    const wake = () => {
      if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
    };
    for (const ev of ["pointerdown", "touchend", "keydown"]) window.addEventListener(ev, wake, { passive: true });
  }
  return ctx;
}

export function getBuses() {
  getCtx();
  return buses!;
}

/** يُستدعى داخل ضغطة اللاعب: يفتح الصوت على iOS/Safari */
export function unlockAudio() {
  const c = getCtx();
  if (c.state !== "running") void c.resume().catch(() => {});
  try {
    const b = c.createBuffer(1, 1, c.sampleRate);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
  } catch {
    /* ignore */
  }
}

export const outputSelectable = () => typeof (AudioContext.prototype as CtxWithSink).setSinkId === "function";

export async function setOutputDevice(id: string): Promise<boolean> {
  const c = getCtx();
  if (!c.setSinkId) return false;
  try {
    await c.setSinkId(id || "");
    return true;
  } catch {
    return false;
  }
}

/** يحوّل عينات بأي معدل إلى AudioBuffer بمعدل السياق (Safari لا يقبل معدلات منخفضة في createBuffer) */
export function toAudioBuffer(samples: Float32Array, rate: number, resampler: (x: Float32Array, from: number, to: number) => Float32Array): AudioBuffer {
  const c = getCtx();
  const data = rate === c.sampleRate ? samples : resampler(samples, rate, c.sampleRate);
  const buf = c.createBuffer(1, Math.max(1, data.length), c.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}
