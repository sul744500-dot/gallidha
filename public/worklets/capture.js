// معالج التقاط الصوت (AudioWorklet): ينسخ عينات المايك الحقيقية إلى الخيط الرئيسي أثناء التسجيل فقط
class GallidhaCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === "start") {
        this.n = 0;
        this.on = true;
      } else if (e.data === "stop") {
        this.flush();
        this.on = false;
        this.port.postMessage({ type: "stopped" });
      }
    };
  }

  flush() {
    if (this.n > 0) {
      this.port.postMessage({ type: "data", samples: this.buf.slice(0, this.n) });
      this.n = 0;
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.on && ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) this.flush();
      }
    }
    return true;
  }
}

registerProcessor("gallidha-capture", GallidhaCapture);
