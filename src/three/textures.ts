// نصوص ثلاثية الأبعاد عبر Canvas: المتصفح يتكفل بتشكيل الحروف العربية والخطوط البديلة (بدون تحميل خطوط خارجية)
import { CanvasTexture, SRGBColorSpace } from "three";

let fontsReady: Promise<unknown> | null = null;
export function whenFonts(): Promise<unknown> {
  fontsReady ??= Promise.all([document.fonts?.load("64px Lalezar"), document.fonts?.load("32px 'Readex Pro Variable'")]).catch(() => null);
  return fontsReady;
}

export interface TextOpts {
  width: number;
  height: number;
  font?: string;
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  bg?: string | null;
  radius?: number;
}

export function drawText(canvas: HTMLCanvasElement, lines: { text: string; size: number; color?: string; y: number }[], o: TextOpts) {
  canvas.width = o.width;
  canvas.height = o.height;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, o.width, o.height);
  if (o.bg) {
    g.fillStyle = o.bg;
    g.beginPath();
    g.roundRect(0, 0, o.width, o.height, o.radius ?? 24);
    g.fill();
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.direction = "rtl";
  for (const l of lines) {
    g.font = `${l.size}px ${o.font ?? "Lalezar, 'Readex Pro Variable', sans-serif"}`;
    if (o.stroke) {
      g.lineWidth = o.strokeWidth ?? 8;
      g.strokeStyle = o.stroke;
      g.lineJoin = "round";
      g.strokeText(l.text, o.width / 2, l.y, o.width - 20);
    }
    g.fillStyle = l.color ?? o.color ?? "#fff";
    g.fillText(l.text, o.width / 2, l.y, o.width - 20);
  }
}

export function makeTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
