// مؤثرات الواجهة مولّدة لحظيًا بـ Web Audio (بدون أي موسيقى خلفية وبدون ملفات منسوخة)
import { getBuses, getCtx } from "../audio/engine";

type Kind = "click" | "pop" | "tick" | "go" | "drum" | "ding" | "fanfare" | "sad" | "whoosh" | "wheelTick" | "join" | "error";

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, glideTo?: number) {
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(getBuses().sfx);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function noiseBurst(start: number, dur: number, gain: number, freq: number) {
  const c = getCtx();
  const len = Math.ceil(dur * c.sampleRate);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  s.connect(f).connect(g).connect(getBuses().sfx);
  s.start(start);
}

export function sfx(kind: Kind) {
  let c: AudioContext;
  try {
    c = getCtx();
  } catch {
    return;
  }
  if (c.state !== "running") return;
  const t = c.currentTime + 0.01;
  switch (kind) {
    case "click":
      tone(880, t, 0.06, "triangle", 0.25, 660);
      break;
    case "pop":
      tone(520, t, 0.09, "sine", 0.3, 1040);
      break;
    case "tick":
      tone(1200, t, 0.05, "square", 0.08);
      break;
    case "go":
      tone(523, t, 0.12, "triangle", 0.3);
      tone(784, t + 0.08, 0.25, "triangle", 0.3);
      noiseBurst(t, 0.15, 0.25, 3000);
      break;
    case "drum":
      for (let i = 0; i < 10; i++) noiseBurst(t + i * 0.06, 0.05, 0.15 + i * 0.02, 900);
      break;
    case "ding":
      tone(1318, t, 0.5, "sine", 0.25);
      tone(1976, t, 0.4, "sine", 0.1);
      break;
    case "fanfare":
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.11, i === 3 ? 0.6 : 0.16, "sawtooth", 0.12));
      break;
    case "sad":
      [392, 370, 349, 330].forEach((f, i) => tone(f, t + i * 0.2, 0.22, "triangle", 0.16));
      break;
    case "whoosh":
      noiseBurst(t, 0.35, 0.2, 1500);
      break;
    case "wheelTick":
      tone(2200, t, 0.03, "square", 0.05);
      break;
    case "join":
      tone(660, t, 0.08, "sine", 0.2);
      tone(990, t + 0.07, 0.12, "sine", 0.2);
      break;
    case "error":
      tone(220, t, 0.18, "square", 0.12, 160);
      break;
  }
}
