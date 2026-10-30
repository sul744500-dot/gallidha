// عامل التقييم: يحلل التسجيلات خارج الخيط الرئيسي حتى لا تتأخر أحداث الغرف أثناء التحليل
import { parentPort } from "node:worker_threads";
import { runScoreJob, type ScoreJob } from "./job";

parentPort?.on("message", (msg: { id: number; job: ScoreJob }) => {
  let result;
  try {
    result = runScoreJob(msg.job);
  } catch {
    result = { status: "corrupt", score: null, parts: null };
  }
  parentPort?.postMessage({ id: msg.id, result });
});
