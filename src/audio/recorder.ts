// تسجيل التقليد: التقاط عينات PCM الحقيقية من مسار التسجيل (AudioWorklet، وبديل ScriptProcessor للمتصفحات القديمة)
// ثم تحويلها إلى 16kHz أحادي وترميزها WAV — نفس الصيغة على كل المتصفحات بما فيها Safari.

import { resample } from "../../shared/audio/resample";
import { encodeWav } from "../../shared/audio/wav";
import { SAMPLE_RATE } from "../../shared/constants";
import { getCtx } from "./engine";
import { mic } from "./mic";

export interface Recording {
  wav: ArrayBuffer;
  samples16k: Float32Array;
  durationMs: number;
  peak: number;
  /** كان المايك مكتومًا طوال التسجيل */
  mutedAll: boolean;
}

let workletReady: Promise<boolean> | null = null;

function loadWorklet(ctx: AudioContext): Promise<boolean> {
  if (!workletReady) {
    workletReady = ctx.audioWorklet
      ? ctx.audioWorklet.addModule("/worklets/capture.js").then(
          () => true,
          () => false,
        )
      : Promise.resolve(false);
  }
  return workletReady;
}

class Recorder {
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private track: MediaStreamTrack | null = null;
  private chunks: Float32Array[] = [];
  private active = false;
  private stopResolve: (() => void) | null = null;
  private unmutedSeen = false;
  private unsub: (() => void) | null = null;

  /** يجهّز سلسلة الالتقاط مسبقًا حتى يبدأ التسجيل فورًا بلحظة «قلّد!» */
  async prepare(): Promise<boolean> {
    const track = mic.recTrack;
    if (!track || track.readyState !== "live") return false;
    if (this.node && this.track === track) return true;
    this.teardown();
    const ctx = getCtx();
    const hasWorklet = await loadWorklet(ctx);
    if (mic.recTrack !== track) return this.prepare();
    this.track = track;
    this.src = ctx.createMediaStreamSource(new MediaStream([track]));
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    if (hasWorklet) {
      const node = new AudioWorkletNode(ctx, "gallidha-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (e: MessageEvent<{ type: string; samples?: Float32Array }>) => {
        if (e.data.type === "data" && e.data.samples && this.active) this.chunks.push(e.data.samples);
        else if (e.data.type === "stopped") this.stopResolve?.();
      };
      this.node = node;
    } else {
      const node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => {
        if (this.active) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      this.node = node;
    }
    this.src.connect(this.node);
    this.node.connect(this.sink).connect(ctx.destination);
    this.unsub ??= mic.store.subscribe(() => {
      if (this.active && !mic.snap.muted) this.unmutedSeen = true;
    });
    return true;
  }

  get recording() {
    return this.active;
  }

  start() {
    if (!this.node) return false;
    this.chunks = [];
    this.active = true;
    this.unmutedSeen = !mic.snap.muted;
    if (this.node instanceof AudioWorkletNode) this.node.port.postMessage("start");
    return true;
  }

  async stop(): Promise<Recording | null> {
    if (!this.active || !this.node) return null;
    const ctx = getCtx();
    if (this.node instanceof AudioWorkletNode) {
      const done = new Promise<void>((r) => (this.stopResolve = r));
      this.node.port.postMessage("stop");
      await Promise.race([done, new Promise((r) => setTimeout(r, 600))]);
      this.stopResolve = null;
    }
    this.active = false;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const raw = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      raw.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    const samples16k = resample(raw, ctx.sampleRate, SAMPLE_RATE);
    let peak = 0;
    for (const v of samples16k) peak = Math.max(peak, Math.abs(v));
    return {
      wav: encodeWav(samples16k, SAMPLE_RATE),
      samples16k,
      durationMs: Math.round((samples16k.length / SAMPLE_RATE) * 1000),
      peak,
      mutedAll: !this.unmutedSeen,
    };
  }

  cancel() {
    this.active = false;
    this.chunks = [];
  }

  teardown() {
    this.active = false;
    this.src?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.src = null;
    this.node = null;
    this.sink = null;
    this.track = null;
  }
}

export const recorder = new Recorder();
