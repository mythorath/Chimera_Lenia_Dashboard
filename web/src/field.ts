// field.ts - 2D canvas fallback when WebGL2 is unavailable. Matches the LIVE
// shader palette: dark bank backdrop, fixed prey ramps, distinct predator accents.
import { FIELD_MAGIC } from "./protocol";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function preyColor(bankA: boolean, t: number): [number, number, number] {
  const amt = Math.pow(Math.max(0, Math.min(1, (t - 0.025) / 0.525)), 0.65);
  if (bankA) {
    return [
      lerp(0.06, 0.15, amt) * 255,
      lerp(0.22, 0.82, amt) * 255,
      lerp(0.18, 0.58, amt) * 255,
    ];
  }
  return [
    lerp(0.18, 0.72, amt) * 255,
    lerp(0.08, 0.28, amt) * 255,
    lerp(0.28, 0.88, amt) * 255,
  ];
}

function predColor(bankA: boolean, t: number): [number, number, number] {
  const amt = Math.pow(Math.max(0, Math.min(1, (t - 0.035) / 0.465)), 0.7);
  if (bankA) {
    return [lerp(0.12, 0.95, amt) * 255, lerp(0.05, 0.42, amt) * 255, lerp(0.02, 0.08, amt) * 255];
  }
  return [lerp(0.02, 0.12, amt) * 255, lerp(0.1, 0.72, amt) * 255, lerp(0.14, 0.92, amt) * 255];
}

function mixRgb(
  bg: [number, number, number],
  fg: [number, number, number],
  a: number,
): [number, number, number] {
  return [lerp(bg[0], fg[0], a), lerp(bg[1], fg[1], a), lerp(bg[2], fg[2], a)];
}

export class FieldView {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private w = 0;
  private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.off = document.createElement("canvas");
    this.octx = this.off.getContext("2d")!;
  }

  private ensure(w: number, h: number): void {
    if (w === this.w && h === this.h && this.img) return;
    this.w = w;
    this.h = h;
    this.off.width = w;
    this.off.height = h;
    this.img = this.octx.createImageData(w, h);
    this.canvas.width = w * 4;
    this.canvas.height = h * 3;
  }

  drawFrame(buf: Uint8Array): void {
    if (buf.length < 4 || buf[0] !== FIELD_MAGIC) return;
    const w = buf[1];
    const h = buf[2];
    const nch = buf[3];
    const plane = w * h;
    if (buf.length < 4 + plane * nch) return;
    this.ensure(w, h);
    const o0 = 4;
    const o1 = 4 + plane;
    const img = this.img!;
    const half = h / 2;
    for (let r = 0; r < h; r++) {
      const bankA = r < half;
      const bg: [number, number, number] = bankA ? [5, 8, 7] : [7, 5, 10];
      for (let c = 0; c < w; c++) {
        const idx = r * w + c;
        const t0 = buf[o0 + idx] / 255;
        const t1 = nch >= 2 ? buf[o1 + idx] / 255 : 0;
        const pAmt = Math.max(0, Math.min(1, (t0 - 0.025) / 0.525));
        const dAmt = Math.max(0, Math.min(1, (t1 - 0.035) / 0.465));
        let col = mixRgb(bg, preyColor(bankA, t0), pAmt * 0.92);
        col = mixRgb(col, predColor(bankA, t1), dAmt * 0.88);
        const overlap = Math.min(pAmt, dAmt);
        if (overlap > 0.08) {
          const both: [number, number, number] = bankA ? [224, 158, 56] : [140, 115, 242];
          col = mixRgb(col, both, overlap * 0.55);
        }
        const o = idx * 4;
        img.data[o] = col[0] | 0;
        img.data[o + 1] = col[1] | 0;
        img.data[o + 2] = col[2] | 0;
        img.data[o + 3] = 255;
      }
    }
    this.octx.putImageData(img, 0, 0);
    const cv = this.canvas;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.off, 0, 0, w, h, 0, 0, cv.width, cv.height);
    this.ctx.strokeStyle = "rgba(242,158,46,0.55)";
    this.ctx.lineWidth = 1;
    const y = half * (cv.height / h);
    this.ctx.beginPath();
    this.ctx.moveTo(0, y);
    this.ctx.lineTo(cv.width, y);
    this.ctx.stroke();
  }
}
