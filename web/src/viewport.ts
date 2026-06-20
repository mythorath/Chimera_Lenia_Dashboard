// viewport.ts - pan + zoom for the torus field (LIVE canvas and CINEMA video share
// the same transform so you can explore the map in either tab).

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_FACTOR = 1.12;

export class StageViewport {
  private scale = 1;
  private panX = 0;
  private panY = 0;
  private dragging = false;
  private activePointer = -1;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private frame: HTMLElement,
    private viewport: HTMLElement,
    private resetBtn: HTMLElement,
  ) {
    frame.addEventListener("wheel", this.onWheel, { passive: false });
    frame.addEventListener("pointerdown", this.onPointerDown);
    frame.addEventListener("pointermove", this.onPointerMove);
    frame.addEventListener("pointerup", this.onPointerUp);
    frame.addEventListener("pointercancel", this.onPointerUp);
    frame.addEventListener("dblclick", (e) => {
      e.preventDefault();
      this.reset();
    });
    resetBtn.addEventListener("click", () => this.reset());
    window.addEventListener("resize", () => this.clampPan());
    this.syncUi();
  }

  reset(): void {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.dragging = false;
    this.activePointer = -1;
    this.syncUi();
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.frame.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    if (next === this.scale) return;

    const wx = (mx - cx - this.panX) / this.scale;
    const wy = (my - cy - this.panY) / this.scale;
    this.scale = next;
    this.panX = mx - cx - wx * this.scale;
    this.panY = my - cy - wy * this.scale;
    this.clampPan();
    this.syncUi();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.scale <= 1) return;
    this.dragging = true;
    this.activePointer = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.frame.setPointerCapture(e.pointerId);
    this.frame.classList.add("is-panning");
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.activePointer) return;
    this.panX += e.clientX - this.lastX;
    this.panY += e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.clampPan();
    this.syncUi();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    this.dragging = false;
    this.activePointer = -1;
    if (this.frame.hasPointerCapture(e.pointerId)) {
      this.frame.releasePointerCapture(e.pointerId);
    }
    this.frame.classList.remove("is-panning");
    this.syncUi();
  };

  private clampPan(): void {
    if (this.scale <= 1) {
      this.panX = 0;
      this.panY = 0;
      return;
    }
    const rect = this.frame.getBoundingClientRect();
    const maxX = (rect.width * (this.scale - 1)) / 2;
    const maxY = (rect.height * (this.scale - 1)) / 2;
    this.panX = Math.max(-maxX, Math.min(maxX, this.panX));
    this.panY = Math.max(-maxY, Math.min(maxY, this.panY));
  }

  private syncUi(): void {
    this.viewport.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    const zoomed = this.scale > 1.001;
    this.resetBtn.hidden = !zoomed;
    this.frame.classList.toggle("is-zoomed", zoomed);
    this.frame.style.cursor = zoomed ? (this.dragging ? "grabbing" : "grab") : "default";
  }
}
