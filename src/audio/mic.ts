// مدير المايك: الطلب الحقيقي للصلاحية عبر getUserMedia (بدون كاميرا إطلاقًا)، التعامل مع كل أخطاء المتصفحات،
// مساران منفصلان من نفس المايك: مسار الدردشة (يُرسل للأصدقاء) ومسار التسجيل (محلي فقط للتقليد)،
// والكتم الفعلي: مسار الدردشة يُعطَّل في البث نفسه (المرسل يبث صمتًا) ومسار التسجيل لا يلتقط شيئًا أثناء الكتم.

import type { MicState } from "../../shared/types";
import { sessionPref } from "../lib/prefs";
import { createStore } from "../lib/store";
import { getCtx } from "./engine";

export type MicStatus = "idle" | "requesting" | "ready" | "denied" | "notfound" | "busy" | "insecure" | "unsupported" | "error" | "ended";

export interface MicSnapshot {
  status: MicStatus;
  errorName: string;
  muted: boolean;
  /** iOS يوقف المايك مؤقتًا أثناء المكالمات/Siri */
  interrupted: boolean;
  deviceId: string;
  devices: { id: string; label: string }[];
  raw: boolean;
  permission: PermissionState | "unknown";
  label: string;
}

type TrackListener = (chat: MediaStreamTrack | null, rec: MediaStreamTrack | null) => void;

interface SavedMic {
  deviceId?: string;
  muted?: boolean;
  raw?: boolean;
}

class MicManager {
  readonly store;
  /** المسار المرسل للأصدقاء عبر WebRTC */
  chatTrack: MediaStreamTrack | null = null;
  /** المسار المحلي لتسجيل التقليد ومؤشر المستوى */
  recTrack: MediaStreamTrack | null = null;
  analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private voiceAllowed = false;
  private listeners = new Set<TrackListener>();
  private buf = new Float32Array(new ArrayBuffer(1024 * 4));
  private pending: Promise<MicStatus> | null = null;

  constructor() {
    const saved = sessionPref.get<SavedMic>("mic") ?? {};
    this.store = createStore<MicSnapshot>({
      status: "idle",
      errorName: "",
      muted: saved.muted ?? false,
      interrupted: false,
      deviceId: saved.deviceId ?? "",
      devices: [],
      raw: saved.raw ?? false,
      permission: "unknown",
      label: "",
    });
    if (typeof navigator !== "undefined") {
      navigator.mediaDevices?.addEventListener?.("devicechange", () => void this.refreshDevices());
      void this.watchPermission();
    }
  }

  get snap(): MicSnapshot {
    return this.store.get();
  }

  private patch(p: Partial<MicSnapshot>) {
    this.store.set((s) => ({ ...s, ...p }));
    const { deviceId, muted, raw } = this.store.get();
    sessionPref.set("mic", { deviceId, muted, raw });
  }

  private async watchPermission() {
    try {
      const st = await navigator.permissions.query({ name: "microphone" as PermissionName });
      this.patch({ permission: st.state });
      st.onchange = () => this.patch({ permission: st.state });
    } catch {
      /* بعض المتصفحات لا تدعم الاستعلام عن صلاحية المايك */
    }
  }

  private constraints(useDevice = true): MediaStreamConstraints {
    const { deviceId, raw } = this.snap;
    return {
      audio: {
        ...(useDevice && deviceId ? { deviceId: { exact: deviceId } } : {}),
        // إلغاء الصدى دائمًا (يمنع دخول صوت الأصدقاء/المرجع في التسجيل)
        echoCancellation: true,
        noiseSuppression: !raw,
        autoGainControl: !raw,
        channelCount: { ideal: 1 },
      },
      // اللعبة لا تطلب الكاميرا إطلاقًا
      video: false,
    };
  }

  /** يطلب صلاحية المايك الحقيقية من المتصفح (نافذة النظام نفسها على الآيفون). يُستدعى من ضغطة اللاعب */
  request(): Promise<MicStatus> {
    if (this.pending) return this.pending;
    this.pending = this.doRequest().finally(() => (this.pending = null));
    return this.pending;
  }

  private async doRequest(): Promise<MicStatus> {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      this.patch({ status: "insecure", errorName: "InsecureContext" });
      return "insecure";
    }
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      this.patch({ status: "unsupported", errorName: "NoMediaDevices" });
      return "unsupported";
    }
    if (this.snap.status === "ready" && this.recTrack?.readyState === "live") return "ready";
    this.patch({ status: "requesting", errorName: "" });
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia(this.constraints());
    } catch (e) {
      const name = (e as DOMException)?.name || "Error";
      // جهاز محفوظ اختفى أو قيود غير مدعومة: نعيد المحاولة بالإعدادات الافتراضية
      const retry = name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError" || name === "TypeError" || (name === "NotFoundError" && !!this.snap.deviceId);
      if (!retry) return this.fail(name);
      try {
        this.patch({ deviceId: "" });
        stream = await md.getUserMedia({ audio: true, video: false });
      } catch (e2) {
        return this.fail((e2 as DOMException)?.name || "Error");
      }
    }
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      return this.fail("NotFoundError");
    }
    this.adopt(stream);
    void this.refreshDevices();
    return "ready";
  }

  private fail(name: string): MicStatus {
    const status: MicStatus =
      name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError"
        ? "denied"
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? "notfound"
          : name === "NotReadableError" || name === "TrackStartError" || name === "AbortError"
            ? "busy"
            : "error";
    this.patch({ status, errorName: name });
    return status;
  }

  private adopt(stream: MediaStream) {
    const old = [this.recTrack, this.chatTrack];
    const rec = stream.getAudioTracks()[0];
    const chat = rec.clone();
    this.recTrack = rec;
    this.chatTrack = chat;
    rec.onended = () => {
      if (this.recTrack !== rec) return;
      this.patch({ status: "ended", errorName: "TrackEnded" });
      this.emit();
    };
    rec.onmute = () => this.recTrack === rec && this.patch({ interrupted: true });
    rec.onunmute = () => this.recTrack === rec && this.patch({ interrupted: false });
    this.applyEnabled();
    try {
      const ctx = getCtx();
      this.source?.disconnect();
      this.source = ctx.createMediaStreamSource(new MediaStream([rec]));
      if (!this.analyser) {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.2;
      }
      this.source.connect(this.analyser);
    } catch {
      /* بدون Web Audio نكمل بدون مؤشر مستوى */
    }
    for (const t of old) t?.stop();
    this.patch({ status: "ready", errorName: "", interrupted: rec.muted, label: rec.label });
    this.emit();
  }

  private applyEnabled() {
    const { muted } = this.snap;
    // الكتم حقيقي: أثناءه لا يُرسل أي صوت ولا يُلتقط أي تسجيل
    if (this.recTrack) this.recTrack.enabled = !muted;
    if (this.chatTrack) this.chatTrack.enabled = !muted && this.voiceAllowed;
  }

  setMuted(muted: boolean) {
    this.patch({ muted });
    this.applyEnabled();
  }

  toggleMute() {
    this.setMuted(!this.snap.muted);
  }

  /** هل يسمح الخادم الآن بالدردشة؟ (تُقفل أثناء الاستماع والتسجيل وتشغيل التسجيلات) */
  setVoiceAllowed(allowed: boolean) {
    this.voiceAllowed = allowed;
    this.applyEnabled();
  }

  async selectDevice(id: string) {
    this.patch({ deviceId: id });
    if (this.snap.status === "ready") await this.restart();
  }

  async setRaw(raw: boolean) {
    this.patch({ raw });
    if (this.snap.status === "ready") await this.restart();
  }

  private async restart() {
    try {
      this.adopt(await navigator.mediaDevices.getUserMedia(this.constraints()));
    } catch (e) {
      this.fail((e as DOMException)?.name || "Error");
    }
  }

  async refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const devices = list.filter((d) => d.kind === "audioinput" && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Mic ${i + 1}` }));
      this.patch({ devices });
    } catch {
      /* ignore */
    }
  }

  /** إيقاف كل مسارات المايك فعليًا (يختفي مؤشر المايك في النظام) */
  stop() {
    this.recTrack?.stop();
    this.chatTrack?.stop();
    this.recTrack = null;
    this.chatTrack = null;
    this.source?.disconnect();
    this.source = null;
    if (this.snap.status !== "denied") this.patch({ status: "idle", interrupted: false });
    this.emit();
  }

  get ready() {
    return this.snap.status === "ready" && this.recTrack?.readyState === "live";
  }

  /** الحالة التي نرسلها للخادم */
  micState(): MicState {
    const s = this.snap.status;
    if (s === "ready") return this.snap.muted ? "muted" : "on";
    if (s === "denied" || s === "insecure" || s === "unsupported") return "denied";
    return "off";
  }

  /** مستوى الصوت الحالي 0..1 (صفر أثناء الكتم: لا نحلل صوتك وأنت مكتوم) */
  level(): number {
    if (!this.analyser || this.snap.muted || !this.ready) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const db = 20 * Math.log10(Math.sqrt(s / this.buf.length) + 1e-9);
    return Math.max(0, Math.min(1, (db + 58) / 46));
  }

  /** موجة الصوت الحالية للرسم */
  waveform(out: Float32Array<ArrayBuffer>): boolean {
    if (!this.analyser || this.snap.muted || !this.ready) return false;
    this.analyser.getFloatTimeDomainData(out);
    return true;
  }

  onTracks(fn: TrackListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.chatTrack, this.recTrack);
  }
}

export const mic = new MicManager();
if (import.meta.env.DEV) (window as unknown as { __mic: MicManager }).__mic = mic;
