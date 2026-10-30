// عملية تقييم تسجيل واحد (تعمل داخل عامل منفصل في الإنتاج، ومباشرة في الاختبارات)

import { readFileSync } from "node:fs";
import { decodeWav } from "../../shared/audio/wav";
import { extractFeatures, type AudioFeatures } from "../../shared/audio/features";
import { compareFeatures } from "../../shared/audio/score";
import { MAX_RECORDING_BYTES, SAMPLE_RATE } from "../../shared/constants";
import type { ScoreParts, ScoreResult } from "../../shared/types";

export interface ScoreJob {
  soundId: string;
  file: string;
  weights?: Partial<ScoreParts>;
  wav: Uint8Array;
  /** أطول مدة مقبولة للتسجيل */
  maxMs: number;
}

const refCache = new Map<string, AudioFeatures>();

function refFeatures(soundId: string, file: string): AudioFeatures {
  let f = refCache.get(soundId);
  if (!f) {
    const d = decodeWav(readFileSync(file));
    f = extractFeatures(d.samples, d.sampleRate);
    refCache.set(soundId, f);
  }
  return f;
}

export function runScoreJob(job: ScoreJob): ScoreResult {
  if (job.wav.byteLength > MAX_RECORDING_BYTES) return { status: "corrupt", score: null, parts: null };
  let samples: Float32Array;
  try {
    const d = decodeWav(job.wav);
    // نقبل فقط الصيغة التي يرسلها عميل اللعبة: أحادي 16 كيلو، 16 بت
    if (d.sampleRate !== SAMPLE_RATE || d.channels !== 1 || d.bitsPerSample !== 16) return { status: "corrupt", score: null, parts: null };
    if ((d.samples.length / SAMPLE_RATE) * 1000 > job.maxMs) return { status: "corrupt", score: null, parts: null };
    samples = d.samples;
  } catch {
    return { status: "corrupt", score: null, parts: null };
  }
  const rec = extractFeatures(samples, SAMPLE_RATE);
  const res = compareFeatures(refFeatures(job.soundId, job.file), rec, { weights: job.weights });
  // لا نرسل تفاصيل التصحيح الداخلية للعملاء
  return { status: res.status, score: res.score, parts: res.parts };
}
