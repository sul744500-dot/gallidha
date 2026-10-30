// مزامنة الوقت مع الخادم (مثل NTP مبسط): كل الأجهزة تشغل الصوت وتبدأ التسجيل بنفس لحظة الخادم
let offset = 0;
let bestRtt = Infinity;

/** وقت الخادم الحالي تقديريًا */
export const serverNow = () => Date.now() + offset;
/** يحوّل وقت خادم إلى تأخير محلي بالملّي ثانية */
export const msUntil = (serverTime: number) => serverTime - serverNow();
export const clockInfo = () => ({ offset, rtt: bestRtt });

export function addSample(t0: number, server: number, t1: number) {
  const rtt = t1 - t0;
  if (rtt < 0 || rtt > 5000) return;
  // نعتمد العينة ذات أقل زمن ذهاب وعودة (أدق)، مع تحديث تدريجي
  if (rtt <= bestRtt * 1.3) {
    const est = server - (t0 + rtt / 2);
    offset = bestRtt === Infinity ? est : offset * 0.5 + est * 0.5;
    bestRtt = Math.min(bestRtt, rtt);
  }
}

export function resetClock() {
  bestRtt = Infinity;
}
