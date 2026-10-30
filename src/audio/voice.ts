// الدردشة الصوتية المباشرة بين اللاعبين (WebRTC شبكي، صوت فقط) مع «التفاوض المثالي» لتجنب التصادم.
// الكتم حقيقي على طرفين: المرسل يعطّل مساره (يبث صمتًا)، والمستقبل يصفّر صوت أي لاعب مقفول/مكتوم
// فحتى لو عدّل أحد عميله لن يزعج الآخرين أثناء الاستماع والتسجيل وتشغيل التسجيلات.

import type { IceServer, RtcData } from "../../shared/types";
import { createStore } from "../lib/store";
import { getBuses, getCtx } from "./engine";
import { mic } from "./mic";

export type PeerState = "connecting" | "connected" | "failed";

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  el: HTMLAudioElement | null;
  src: MediaStreamAudioSourceNode | null;
  gain: GainNode;
  analyser: AnalyserNode;
  state: PeerState;
}

export interface VoiceSnapshot {
  enabled: boolean;
  open: boolean;
  peers: Record<string, PeerState>;
  localMuted: string[];
}

const buf = new Float32Array(512);

export interface PeerStats {
  state: string;
  audioLevel: number | null;
  /** مجموع طاقة الصوت المستقبَل (يزيد فقط إذا وصل صوت حقيقي) */
  energy: number;
  duration: number;
  bytes: number;
  sent: number;
  sourceLevel: number | null;
}

class VoiceMesh {
  readonly store = createStore<VoiceSnapshot>({ enabled: false, open: false, peers: {}, localMuted: [] });
  private peers = new Map<string, Peer>();
  private me = "";
  private ice: IceServer[] = [];
  private send: ((to: string, data: RtcData) => void) | null = null;
  /** لاعبون كتمهم المضيف للجميع أو كتموا أنفسهم: لا نسمعهم */
  private blocked = new Set<string>();
  private localMuted = new Set<string>();
  private unsubTracks: (() => void) | null = null;

  start(me: string, ice: IceServer[], send: (to: string, data: RtcData) => void) {
    if (this.me && this.me !== me) this.stop();
    this.me = me;
    this.ice = ice;
    this.send = send;
    this.unsubTracks ??= mic.onTracks((chat) => {
      for (const p of this.peers.values()) void this.sender(p)?.replaceTrack(chat).catch(() => {});
    });
  }

  private sender(p: Peer): RTCRtpSender | null {
    return p.pc.getTransceivers().find((t) => t.receiver.track?.kind === "audio")?.sender ?? null;
  }

  /** مزامنة قائمة الأقران مع لاعبي الغرفة المتصلين */
  sync(ids: string[], enabled: boolean) {
    this.store.set((s) => (s.enabled === enabled ? s : { ...s, enabled }));
    const want = new Set(enabled ? ids.filter((id) => id !== this.me) : []);
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.close(id);
    for (const id of want) if (!this.peers.has(id)) this.create(id);
  }

  private create(id: string) {
    const pc = new RTCPeerConnection({ iceServers: this.ice as RTCIceServer[] });
    const ctx = getCtx();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    gain.connect(getBuses().voice);
    const p: Peer = { id, pc, polite: this.me > id, makingOffer: false, ignoreOffer: false, el: null, src: null, gain, analyser, state: "connecting" };
    this.peers.set(id, p);
    this.setState(id, "connecting");

    // صاحب المعرّف الأصغر ينشئ القناة الصوتية، والآخر يرد عليها (قناة واحدة لكل زوج)
    if (this.me < id) {
      const tr = pc.addTransceiver("audio", { direction: "sendrecv" });
      void tr.sender.replaceTrack(mic.chatTrack).catch(() => {});
    }

    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        this.send?.(id, { type: "description", sdp: pc.localDescription!.toJSON() });
      } catch {
        /* ignore */
      } finally {
        p.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => this.send?.(id, { type: "candidate", candidate: candidate ? (candidate.toJSON() as { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }) : null });
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") this.setState(id, "connected");
      else if (s === "failed") {
        this.setState(id, "failed");
        pc.restartIce?.();
      } else if (s === "connecting" || s === "new") this.setState(id, "connecting");
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      // Chrome لا يمرر صوت WebRTC إلى Web Audio إلا إذا ارتبط بعنصر صوت (نتركه مكتومًا)
      if (!p.el) {
        p.el = new Audio();
        p.el.muted = true;
        p.el.setAttribute("playsinline", "");
      }
      p.el.srcObject = stream;
      void p.el.play().catch(() => {});
      p.src?.disconnect();
      p.src = getCtx().createMediaStreamSource(stream);
      p.src.connect(p.analyser);
      p.src.connect(p.gain);
      this.applyGain(p);
    };
  }

  async handleSignal(from: string, data: RtcData) {
    let p = this.peers.get(from);
    if (!p) {
      if (!this.store.get().enabled) return;
      this.create(from);
      p = this.peers.get(from)!;
    }
    const pc = p.pc;
    try {
      if (data.type === "description") {
        const desc = data.sdp as RTCSessionDescriptionInit;
        const collision = desc.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          // الطرف المستقبل يضع مساره في نفس القناة قبل الرد
          const tr = pc.getTransceivers()[0];
          if (tr) {
            await tr.sender.replaceTrack(mic.chatTrack).catch(() => {});
            tr.direction = "sendrecv";
          }
          await pc.setLocalDescription();
          this.send?.(from, { type: "description", sdp: pc.localDescription!.toJSON() });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!p.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn("rtc", err);
    }
  }

  private setState(id: string, state: PeerState) {
    const p = this.peers.get(id);
    if (p) p.state = state;
    this.store.set((s) => ({ ...s, peers: { ...s.peers, [id]: state } }));
  }

  private applyGain(p: Peer) {
    const s = this.store.get();
    const audible = s.enabled && s.open && !this.blocked.has(p.id) && !this.localMuted.has(p.id);
    p.gain.gain.setTargetAtTime(audible ? 1 : 0, getCtx().currentTime, 0.04);
  }

  /** قفل/فتح الدردشة حسب مرحلة اللعبة (يقرره الخادم) */
  setOpen(open: boolean) {
    this.store.set((s) => (s.open === open ? s : { ...s, open }));
    mic.setVoiceAllowed(open && this.store.get().enabled);
    for (const p of this.peers.values()) this.applyGain(p);
  }

  /** لاعبون لا يجب سماعهم: مكتومون من المضيف، أو كاتمين أنفسهم */
  setBlocked(ids: string[]) {
    this.blocked = new Set(ids);
    for (const p of this.peers.values()) this.applyGain(p);
  }

  toggleLocalMute(id: string) {
    if (this.localMuted.has(id)) this.localMuted.delete(id);
    else this.localMuted.add(id);
    this.store.set((s) => ({ ...s, localMuted: [...this.localMuted] }));
    const p = this.peers.get(id);
    if (p) this.applyGain(p);
  }

  /** مستوى صوت لاعب (لمؤشر «يتكلم» وحركة فم الشخصية) */
  level(id: string): number {
    const p = this.peers.get(id);
    const s = this.store.get();
    if (!p?.src || !s.open || this.blocked.has(id)) return 0;
    p.analyser.getFloatTimeDomainData(buf);
    let e = 0;
    for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
    const db = 20 * Math.log10(Math.sqrt(e / buf.length) + 1e-9);
    return Math.max(0, Math.min(1, (db + 58) / 46));
  }

  /** للاختبارات: مستوى الصوت الواصل فعليًا من الشبكة قبل أي قفل محلي (يثبت أن الكتم في مسار البث نفسه) */
  rawLevel(id: string): number {
    const p = this.peers.get(id);
    if (!p?.src) return 0;
    p.analyser.getFloatTimeDomainData(buf);
    let e = 0;
    for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
    return Math.sqrt(e / buf.length);
  }

  private close(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.onnegotiationneeded = null;
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.src?.disconnect();
    p.gain.disconnect();
    if (p.el) {
      p.el.srcObject = null;
      p.el.remove();
    }
    this.peers.delete(id);
    this.store.set((s) => {
      const peers = { ...s.peers };
      delete peers[id];
      return { ...s, peers };
    });
  }

  /** إغلاق كل الاتصالات عند مغادرة الغرفة */
  stop() {
    for (const id of [...this.peers.keys()]) this.close(id);
    this.me = "";
    this.send = null;
    this.blocked.clear();
    mic.setVoiceAllowed(false);
    this.store.set({ enabled: false, open: false, peers: {}, localMuted: [...this.localMuted] });
  }

  /** للاختبارات: إحصاءات مستوى الصوت المستقبَل فعليًا من كل قرين */
  async stats(): Promise<Record<string, PeerStats>> {
    const out: Record<string, PeerStats> = {};
    for (const p of this.peers.values()) {
      const s: PeerStats = { state: p.pc.connectionState, audioLevel: null, energy: 0, duration: 0, bytes: 0, sent: 0, sourceLevel: null };
      try {
        const report = await p.pc.getStats();
        report.forEach((r: Record<string, number | string | undefined>) => {
          if (r.type === "inbound-rtp" && r.kind === "audio") {
            s.audioLevel = (r.audioLevel as number) ?? null;
            s.energy = (r.totalAudioEnergy as number) ?? 0;
            s.duration = (r.totalSamplesDuration as number) ?? 0;
            s.bytes = (r.bytesReceived as number) ?? 0;
          } else if (r.type === "outbound-rtp" && r.kind === "audio") s.sent = (r.bytesSent as number) ?? 0;
          else if (r.type === "media-source" && r.kind === "audio") s.sourceLevel = (r.audioLevel as number) ?? null;
        });
      } catch {
        /* ignore */
      }
      out[p.id] = s;
    }
    return out;
  }
}

export const voice = new VoiceMesh();
