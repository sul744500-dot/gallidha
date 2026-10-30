// يولّد مكتبة الأصوات الأصلية: ملفات WAV حقيقية + pack.json لكل باقة داخل public/packs
//   npm run packs                     توليد الكل
//   npm run packs -- --spectro <dir>  + صور طيفية (PNG) للمراجعة البصرية

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { encodeWav } from "../shared/audio/wav";
import { fft, hann } from "../shared/audio/dsp";
import { PACKS } from "./synth/sounds";
import { SR } from "./synth/engine";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = resolve(root, "public/packs");
const spectroIdx = process.argv.indexOf("--spectro");
const spectroDir = spectroIdx > 0 ? resolve(process.argv[spectroIdx + 1]) : null;

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const chunk = (type: string, data: Uint8Array) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), Buffer.from(data)]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}

function spectrogram(x: Float32Array, file: string) {
  const N = 1024;
  const hop = 128;
  const frames = Math.max(1, Math.floor((x.length - N) / hop));
  const bins = 320; // حتى ~6.9kHz
  const w = hann(N);
  const rgb = new Uint8Array(frames * bins * 3);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let t = 0; t < frames; t++) {
    for (let i = 0; i < N; i++) {
      re[i] = x[t * hop + i] * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const db = 10 * Math.log10(re[b] ** 2 + im[b] ** 2 + 1e-10);
      const v = Math.max(0, Math.min(1, (db + 40) / 70));
      const y = bins - 1 - b;
      const o = (y * frames + t) * 3;
      rgb[o] = Math.round(255 * Math.min(1, v * 1.6));
      rgb[o + 1] = Math.round(255 * Math.max(0, v * 1.4 - 0.4));
      rgb[o + 2] = Math.round(255 * Math.max(0, Math.min(1, 0.4 + v - v * v * 1.2)));
    }
  }
  writeFileSync(file, png(frames, bins, rgb));
}

let total = 0;
for (const pack of PACKS) {
  const dir = join(outDir, pack.id);
  mkdirSync(dir, { recursive: true });
  const sounds = [];
  for (const s of pack.sounds) {
    const t0 = performance.now();
    const samples = s.make();
    const file = `${s.id}.wav`;
    writeFileSync(join(dir, file), Buffer.from(encodeWav(samples, SR)));
    if (spectroDir) {
      mkdirSync(spectroDir, { recursive: true });
      spectrogram(samples, join(spectroDir, `${pack.id}-${s.id}.png`));
    }
    const ms = Math.round((samples.length / SR) * 1000);
    console.log(`  ${pack.emoji} ${pack.id}/${file}  ${ms}ms  (${Math.round(performance.now() - t0)}ms)`);
    sounds.push({ id: s.id, file, name: s.name, emoji: s.emoji, difficulty: s.difficulty, ...(s.weights ? { weights: s.weights } : {}) });
    total++;
  }
  const manifest = {
    id: pack.id,
    category: pack.category,
    emoji: pack.emoji,
    name: pack.name,
    description: pack.description,
    license: "Original sounds synthesized procedurally by the GALLIDHA sound engine (scripts/synth). Owned by the project.",
    sounds,
  };
  writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest, null, 2) + "\n");
}
console.log(`> ${total} صوت في ${PACKS.length} باقات → ${outDir}`);
