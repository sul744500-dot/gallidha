// ترميز وفك ملفات WAV (PCM) — صيغة يشغّلها كل متصفح بما فيه Safari على الآيفون،
// ويقرؤها الخادم مباشرة بدون أي مكتبة أو ffmpeg.

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** القنوات مدموجة في قناة واحدة بقيم بين -1 و 1 */
  samples: Float32Array;
}

/** يرمّز إشارة أحادية إلى WAV بدقة 16 بت */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // أحادي
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++, o += 2) {
    let s = samples[i];
    if (!(s === s)) s = 0; // NaN
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    v.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return buf;
}

function toView(input: ArrayBuffer | ArrayBufferView): DataView {
  if (input instanceof ArrayBuffer) return new DataView(input);
  return new DataView(input.buffer, input.byteOffset, input.byteLength);
}

/** يفك WAV من نوع PCM (8/16/24/32 بت) أو Float32. يرمي خطأ عند أي ملف غير صالح */
export function decodeWav(input: ArrayBuffer | ArrayBufferView): DecodedWav {
  const v = toView(input);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (v.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a wav file");
  let off = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= v.byteLength) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      if (size < 16) throw new Error("bad fmt chunk");
      let format = v.getUint16(body, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = {
        format,
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        bits: v.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      dataOff = body;
      dataLen = Math.min(size, v.byteLength - body);
      break;
    }
    off = body + size + (size & 1);
  }
  if (!fmt || dataOff < 0) throw new Error("missing fmt/data chunk");
  const { format, channels, sampleRate, bits } = fmt;
  if (channels < 1 || channels > 8) throw new Error("bad channel count");
  if (sampleRate < 4000 || sampleRate > 192000) throw new Error("bad sample rate");
  const bytes = bits / 8;
  const isFloat = format === 3;
  if (!(format === 1 || isFloat)) throw new Error("unsupported wav format");
  if (isFloat ? bits !== 32 : ![8, 16, 24, 32].includes(bits)) throw new Error("unsupported bit depth");
  const frames = Math.floor(dataLen / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const o = dataOff + (i * channels + c) * bytes;
      let s: number;
      if (isFloat) s = v.getFloat32(o, true);
      else if (bits === 16) s = v.getInt16(o, true) / 32768;
      else if (bits === 8) s = (v.getUint8(o) - 128) / 128;
      else if (bits === 24) {
        const x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16);
        s = x / 8388608;
      } else s = v.getInt32(o, true) / 2147483648;
      acc += s;
    }
    const m = acc / channels;
    out[i] = m === m && Number.isFinite(m) ? m : 0;
  }
  return { sampleRate, channels, bitsPerSample: bits, samples: out };
}

/** يقرأ مدة الملف من الترويسة فقط */
export function wavDurationMs(input: ArrayBuffer | ArrayBufferView): number {
  const d = decodeWav(input);
  return Math.round((d.samples.length / d.sampleRate) * 1000);
}
