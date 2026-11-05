// «قوالب الكلمات»: نطق نظيف لكلمات كل مقطع بصوت Piper العربي (محلي بالكامل، بدون إنترنت).
// الخادم يعدّ فيها انتقالات النطق ليعرف كم حرفًا ومقطعًا يُفترض أن ينطقها اللاعب حتى لو غنّاها ببطء.
// لا يُشغَّل في الإنتاج — الملفات الناتجة محفوظة في public/packs/trends/*.words.wav
//   PIPER_DIR=<مجلد فيه node_modules/sherpa-onnx-node و models/vits-piper-ar_JO-kareem-medium> node scripts/make-word-templates.cjs
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.PIPER_DIR ?? path.resolve(__dirname, "../../olama-alarab");
const sherpa = createRequire(path.join(BASE, "package.json"))("sherpa-onnx-node");
const model = path.join(BASE, "models/vits-piper-ar_JO-kareem-medium");
const OUT = path.resolve(__dirname, "../public/packs/trends");

// النص مشكّل بالكامل لأن الصوت يحتاجه لينطق صح (وبلهجة المقطع قدر الإمكان: «اَلْقُمْ» لا «اِلْقَمْ»)
const TEXT = {
  "algum-algum": "اَلْقُمْ، اَلْقُمْ، اَلْقُمْ، اَلْقُمْ يَالْهَطْفْ",
  "huna-marru": "هُنَا مَرُّوا وَكَانُوا قُدْوَةً لِلنَّاسْ",
  "splosh-toot": "سِبْلُوشْ تُوتْ، سِبْلُوشْ، سِبْلُوشْ تُوتْ، سِبْلُوشْ",
  "six-seven": "سِكْسْ سِفِنْ",
};

const tts = new sherpa.OfflineTts({
  model: { vits: { model: path.join(model, "ar_JO-kareem-medium.onnx"), tokens: path.join(model, "tokens.txt"), dataDir: path.join(model, "espeak-ng-data") }, numThreads: 2, provider: "cpu", debug: false },
  maxNumSentences: 1,
});

function writeWav(file, samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

for (const [id, text] of Object.entries(TEXT)) {
  const a = tts.generate({ text, sid: 0, speed: 1 });
  // نصف ثانية صمت قبل وبعد: يحتاجها التحليل لتقدير ضجيج الخلفية
  const pad = Math.round(a.sampleRate * 0.5);
  const x = new Float32Array(a.samples.length + 2 * pad);
  x.set(a.samples, pad);
  const file = path.join(OUT, `${id}.words.wav`);
  writeWav(file, x, a.sampleRate);
  console.log(path.basename(file), (x.length / a.sampleRate).toFixed(2) + "s");
}
