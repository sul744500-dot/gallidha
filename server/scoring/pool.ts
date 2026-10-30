// مجموعة عمال التقييم مع طابور وإعادة تشغيل العامل إذا تعطل

import { cpus } from "node:os";
import { Worker } from "node:worker_threads";
import type { ScoreResult } from "../../shared/types";
import { runScoreJob, type ScoreJob } from "./job";

export interface Scorer {
  score(job: ScoreJob): Promise<ScoreResult>;
  close(): void;
}

/** تقييم مباشر في نفس الخيط (للاختبارات والأدوات) */
export function inlineScorer(): Scorer {
  return {
    score: async (job) => runScoreJob(job),
    close() {},
  };
}

const JOB_TIMEOUT = 15_000;

export function workerScorer(size = Math.min(2, Math.max(1, cpus().length - 1))): Scorer {
  const url = new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url);
  type Pending = { resolve: (r: ScoreResult) => void; timer: ReturnType<typeof setTimeout> };
  const pending = new Map<number, Pending>();
  const queue: { id: number; job: ScoreJob }[] = [];
  let nextId = 1;
  let closed = false;

  interface Slot {
    worker: Worker;
    busy: number | null;
  }
  const slots: Slot[] = [];

  const finish = (id: number, result: ScoreResult) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve(result);
  };

  const spawn = (): Slot => {
    const slot: Slot = { worker: new Worker(url), busy: null };
    slot.worker.on("message", (msg: { id: number; result: ScoreResult }) => {
      slot.busy = null;
      finish(msg.id, msg.result);
      pump();
    });
    const fail = () => {
      if (slot.busy !== null) finish(slot.busy, { status: "corrupt", score: null, parts: null });
      const i = slots.indexOf(slot);
      if (i >= 0) slots.splice(i, 1);
      if (!closed) {
        slots.push(spawn());
        pump();
      }
    };
    slot.worker.on("error", (err: Error) => {
      console.error("! عامل التقييم تعطل:", err.message);
      fail();
    });
    slot.worker.on("exit", (code) => {
      if (code !== 0 && !closed) fail();
    });
    return slot;
  };

  const pump = () => {
    for (const slot of slots) {
      if (slot.busy !== null || !queue.length) continue;
      const item = queue.shift()!;
      slot.busy = item.id;
      // ننسخ البيانات لأن مخزن Socket.IO قد يُعاد استخدامه
      slot.worker.postMessage({ id: item.id, job: { ...item.job, wav: new Uint8Array(item.job.wav) } });
    }
  };

  for (let i = 0; i < size; i++) slots.push(spawn());

  return {
    score(job) {
      return new Promise<ScoreResult>((resolve) => {
        const id = nextId++;
        const timer = setTimeout(() => finish(id, { status: "corrupt", score: null, parts: null }), JOB_TIMEOUT);
        pending.set(id, { resolve, timer });
        queue.push({ id, job });
        pump();
      });
    },
    close() {
      closed = true;
      for (const s of slots) void s.worker.terminate();
      for (const [id] of pending) finish(id, { status: "corrupt", score: null, parts: null });
    },
  };
}
