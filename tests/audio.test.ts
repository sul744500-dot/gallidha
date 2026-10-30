import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav } from "../shared/audio/wav";
import { resample } from "../shared/audio/resample";
import { extractFeatures } from "../shared/audio/features";
import { assessQuality, compareFeatures } from "../shared/audio/score";
import { imitate } from "../shared/audio/imitate";
import { applySabotage, sabotageDurationMs, SABOTAGES } from "../shared/audio/effects";
import { SAMPLE_RATE } from "../shared/constants";

const root = fileURLToPath(new URL("..", import.meta.url));
const packs = resolve(root, "public/packs");

function loadRef(path: string) {
  const d = decodeWav(readFileSync(join(packs, path)));
  return { samples: d.samples, rate: d.sampleRate, f: extractFeatures(d.samples, d.sampleRate) };
}

function tone(freq: number, sec: number, sr = SAMPLE_RATE, amp = 0.5) {
  const x = new Float32Array(Math.round(sec * sr));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

describe("WAV", () => {
  it("يرمّز ويفك بدقة 16 بت", () => {
    const x = tone(440, 0.25);
    const back = decodeWav(encodeWav(x, SAMPLE_RATE));
    expect(back.sampleRate).toBe(SAMPLE_RATE);
    expect(back.samples.length).toBe(x.length);
    let err = 0;
    for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(x[i] - back.samples[i]));
    expect(err).toBeLessThan(1 / 16000);
  });
  it("يرفض الملفات التالفة", () => {
    expect(() => decodeWav(new Uint8Array(100))).toThrow();
    const good = new Uint8Array(encodeWav(tone(200, 0.1), SAMPLE_RATE));
    good[20] = 85; // صيغة غير مدعومة
    expect(() => decodeWav(good)).toThrow();
  });
});

describe("تحويل معدل العينات", () => {
  it("يحافظ على التردد عند التحويل من 48k إلى 16k", () => {
    const x = tone(1000, 0.5, 48000);
    const y = resample(x, 48000, 16000);
    expect(y.length).toBe(8000);
    const f = extractFeatures(y, 16000);
    expect(55 * 2 ** (f.pitch[20] / 12)).toBeCloseTo(1000, -1);
  });
  it("يزيل الترددات فوق نايكوِست الجديد (لا تشوه طيفي)", () => {
    const x = tone(11000, 0.5, 48000);
    const y = resample(x, 48000, 16000);
    let rms = 0;
    for (let i = 100; i < y.length - 100; i++) rms += y[i] * y[i];
    expect(Math.sqrt(rms / y.length)).toBeLessThan(0.01);
  });
});

describe("استخراج الخصائص", () => {
  it("يكشف طبقة الصوت بدقة للأصوات العميقة والحادة", () => {
    for (const hz of [85, 150, 300, 600, 1000]) {
      const f = extractFeatures(tone(hz, 1), SAMPLE_RATE);
      const est = 55 * 2 ** (f.pitch[40] / 12);
      expect(Math.abs(12 * Math.log2(est / hz))).toBeLessThan(0.3);
    }
  });
  it("يعد بدايات النبرات لنقرات متتالية", () => {
    const x = new Float32Array(SAMPLE_RATE * 2);
    for (let k = 0; k < 5; k++) {
      const s0 = Math.round((0.2 + k * 0.3) * SAMPLE_RATE);
      for (let i = 0; i < 1200; i++) x[s0 + i] = 0.6 * Math.sin((2 * Math.PI * 300 * i) / SAMPLE_RATE) * (1 - i / 1200);
    }
    const f = extractFeatures(x, SAMPLE_RATE);
    expect(f.onsets.length).toBe(5);
    expect(f.segments.length).toBe(5);
  });
  it("الصوت المنزلق (سارينة) ليس بدايات متعددة", () => {
    const sec = 2;
    const x = new Float32Array(sec * SAMPLE_RATE);
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const hz = 300 + 200 * Math.sin((2 * Math.PI * 0.7 * i) / SAMPLE_RATE);
      ph += hz / SAMPLE_RATE;
      x[i] = 0.5 * Math.sin(2 * Math.PI * ph);
    }
    expect(extractFeatures(x, SAMPLE_RATE).onsets.length).toBeLessThanOrEqual(2);
  });
});

describe("فحص جودة التسجيل", () => {
  it("التسجيل الصامت لا يأخذ درجة", () => {
    expect(assessQuality(extractFeatures(new Float32Array(SAMPLE_RATE * 3), SAMPLE_RATE))).toBe("silent");
  });
  it("الضجيج الخافت فقط = غير موثوق", () => {
    const x = new Float32Array(SAMPLE_RATE * 3);
    for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * 0.003;
    expect(["noisy", "silent"]).toContain(assessQuality(extractFeatures(x, SAMPLE_RATE)));
  });
  it("التشبّع الشديد = clipped", () => {
    const x = tone(200, 2, SAMPLE_RATE, 4).map((v) => Math.max(-1, Math.min(1, v)));
    expect(assessQuality(extractFeatures(x, SAMPLE_RATE))).toBe("clipped");
  });
  it("صوت قصير جدًا", () => {
    const x = new Float32Array(SAMPLE_RATE * 2);
    x.set(tone(300, 0.12), 8000);
    expect(assessQuality(extractFeatures(x, SAMPLE_RATE))).toBe("too_short");
  });
});

describe("التقييم مقابل أصوات المكتبة", () => {
  const all: string[] = [];
  for (const pack of readdirSync(packs)) {
    const m = JSON.parse(readFileSync(join(packs, pack, "pack.json"), "utf8"));
    for (const s of m.sounds) all.push(`${pack}/${s.file}`);
  }
  const sample = all.filter((_, i) => i % 3 === 0);

  it("التقليد المتقن > غير المتقن > صوت مختلف (في المتوسط)", () => {
    let good = 0;
    let sloppy = 0;
    let wrong = 0;
    sample.forEach((path, i) => {
      const ref = loadRef(path);
      const other = loadRef(all[(all.indexOf(path) + 5) % all.length]);
      const g = compareFeatures(ref.f, extractFeatures(imitate(ref.samples, ref.rate, { sloppiness: 0.15, seed: i }), SAMPLE_RATE));
      const s = compareFeatures(ref.f, extractFeatures(imitate(ref.samples, ref.rate, { sloppiness: 0.7, timeStretch: 1.35, flatten: 0.5, seed: i }), SAMPLE_RATE));
      const w = compareFeatures(ref.f, extractFeatures(imitate(other.samples, other.rate, { sloppiness: 0.15, seed: i }), SAMPLE_RATE));
      good += g.score ?? 0;
      sloppy += s.score ?? 0;
      wrong += w.score ?? 0;
    });
    const n = sample.length;
    expect(good / n).toBeGreaterThan(68);
    expect(good / n - sloppy / n).toBeGreaterThan(6);
    expect(sloppy / n - wrong / n).toBeGreaterThan(25);
    expect(wrong / n).toBeLessThan(35);
  });

  it("عادل مع الأصوات العميقة والحادة (لا عقوبة على طبقة الصوت الطبيعية)", () => {
    let normal = 0;
    let deep = 0;
    let high = 0;
    sample.forEach((path, i) => {
      const ref = loadRef(path);
      const at = (o: Parameters<typeof imitate>[2]) => compareFeatures(ref.f, extractFeatures(imitate(ref.samples, ref.rate, o), SAMPLE_RATE)).score ?? 0;
      normal += at({ sloppiness: 0.15, seed: i });
      deep += at({ sloppiness: 0.15, pitchFactor: 0.5, range: [75, 200], vowel: [600, 1000, 2300], seed: i });
      high += at({ sloppiness: 0.15, pitchFactor: 1.6, range: [230, 650], vowel: [850, 1500, 2900], seed: i });
    });
    const n = sample.length;
    expect(Math.abs(normal - deep) / n).toBeLessThan(7);
    expect(Math.abs(normal - high) / n).toBeLessThan(7);
  });

  it("تشغيل الملف الأصلي للمايك يُكشف بدل أن يأخذ 100", () => {
    const ref = loadRef("animals/rooster.wav");
    const replay = resample(ref.samples, ref.rate, SAMPLE_RATE);
    // تشغيل عبر سماعة: ضجيج خفيف وإزاحة زمنية
    const played = new Float32Array(replay.length + 4000);
    for (let i = 0; i < replay.length; i++) played[i + 4000] = replay[i] * 0.6 + (Math.random() * 2 - 1) * 0.002;
    expect(compareFeatures(ref.f, extractFeatures(played, SAMPLE_RATE)).status).toBe("suspicious");
  });

  it("النتيجة حتمية وقابلة للتكرار", () => {
    const ref = loadRef("animals/cow.wav");
    const rec = extractFeatures(imitate(ref.samples, ref.rate, { seed: 3 }), SAMPLE_RATE);
    const a = compareFeatures(ref.f, rec);
    const b = compareFeatures(ref.f, rec);
    expect(a).toEqual(b);
    expect(a.parts).not.toBeNull();
    for (const v of Object.values(a.parts!)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("مؤثرات التخريب", () => {
  it("مدة التشغيل الفعلية تطابق ما يحسبه الخادم", () => {
    const x = tone(250, 2);
    for (const id of SABOTAGES) {
      const y = applySabotage(id, x, SAMPLE_RATE, 7);
      const expected = sabotageDurationMs(id, 2000);
      expect(Math.abs((y.length / SAMPLE_RATE) * 1000 - expected)).toBeLessThan(25);
      expect(y.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
  it("تغيير الطبقة يغيّر التردد ويحافظ على المدة", () => {
    const x = tone(220, 1.5);
    const up = extractFeatures(applySabotage("chipmunk", x, SAMPLE_RATE), SAMPLE_RATE);
    const est = 55 * 2 ** (up.pitch[60] / 12);
    expect(12 * Math.log2(est / 220)).toBeGreaterThan(6);
    const deep = extractFeatures(applySabotage("deep", x, SAMPLE_RATE), SAMPLE_RATE);
    expect(12 * Math.log2(55 * 2 ** (deep.pitch[60] / 12) / 220)).toBeLessThan(-5);
  });
  it("التقطيع حتمي بنفس البذرة", () => {
    const x = tone(300, 1);
    expect(applySabotage("chop", x, SAMPLE_RATE, 42)).toEqual(applySabotage("chop", x, SAMPLE_RATE, 42));
  });
});
