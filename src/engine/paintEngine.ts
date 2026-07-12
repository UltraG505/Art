import type { Stroke, StrokePoint } from "./types";
import { renderStroke, strokeSegment, initStroke, type StampState, type RandFn } from "./wetBlendBrush";
import { mulberry32 } from "./random";
import { createGrainTile, paintGrainBackground } from "./grain";

const PAPER_COLOR = "#e8e2d6";

export class PaintEngine {
  readonly root: HTMLDivElement;
  private bgCanvas: HTMLCanvasElement;
  private paintCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private paintCtx: CanvasRenderingContext2D;
  private grainTile: HTMLCanvasElement;

  private strokes: Stroke[] = [];
  private redoStack: Stroke[] = [];
  private current: Stroke | null = null;
  private liveState: StampState | null = null;
  private liveRand: RandFn | null = null;

  private dpr = Math.max(1, window.devicePixelRatio || 1);
  private cssW = 0;
  private cssH = 0;

  color = "#7a1f2b";
  size = 34;

  onHistoryChange: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "paint-stack";

    this.bgCanvas = document.createElement("canvas");
    this.bgCanvas.className = "paint-layer";
    this.paintCanvas = document.createElement("canvas");
    this.paintCanvas.className = "paint-layer";
    this.overlayCanvas = document.createElement("canvas");
    this.overlayCanvas.className = "paint-layer paint-layer--overlay";

    this.root.append(this.bgCanvas, this.paintCanvas, this.overlayCanvas);
    container.appendChild(this.root);

    this.paintCtx = this.paintCanvas.getContext("2d")!;
    this.grainTile = createGrainTile();

    this.resize();
    window.addEventListener("resize", () => this.resize());

    this.bindPointerEvents();
  }

  private resize() {
    const rect = this.root.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
    for (const c of [this.bgCanvas, this.paintCanvas, this.overlayCanvas]) {
      c.width = Math.round(this.cssW * this.dpr);
      c.height = Math.round(this.cssH * this.dpr);
    }
    this.redrawAll();
  }

  private redrawAll() {
    const bgCtx = this.bgCanvas.getContext("2d")!;
    bgCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    paintGrainBackground(bgCtx, this.cssW, this.cssH, this.grainTile, PAPER_COLOR);

    const ovCtx = this.overlayCanvas.getContext("2d")!;
    ovCtx.setTransform(1, 0, 0, 1, 0, 0);
    ovCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    const pattern = ovCtx.createPattern(this.grainTile, "repeat");
    if (pattern) {
      ovCtx.globalAlpha = 0.16;
      ovCtx.globalCompositeOperation = "multiply";
      ovCtx.fillStyle = pattern;
      ovCtx.fillRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      ovCtx.globalAlpha = 1;
      ovCtx.globalCompositeOperation = "source-over";
    }

    this.paintCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.paintCtx.clearRect(0, 0, this.cssW, this.cssH);
    for (const stroke of this.strokes) {
      renderStroke(this.paintCtx, stroke);
    }
  }

  private bindPointerEvents() {
    const el = this.paintCanvas;
    el.style.touchAction = "none";

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      const p = this.toLocal(e);
      const seed = Math.floor(Math.random() * 2 ** 31);
      this.current = {
        id: crypto.randomUUID(),
        brush: "wetBlend",
        color: this.color,
        size: this.size,
        seed,
        points: [p],
      };
      this.liveState = initStroke(this.color);
      this.liveRand = mulberry32(seed);
      this.redoStack = [];
    });

    el.addEventListener("pointermove", (e) => {
      if (!this.current || !this.liveState || !this.liveRand) return;
      const prev = this.current.points[this.current.points.length - 1];
      const p = this.toLocal(e);
      this.current.points.push(p);
      strokeSegment(this.paintCtx, this.liveState, this.liveRand, prev, p, this.current.color, this.current.size);
    });

    const finish = () => {
      if (!this.current) return;
      if (this.current.points.length === 1 && this.liveState) {
        const p = this.current.points[0];
        strokeSegment(this.paintCtx, this.liveState, this.liveRand!, p, p, this.current.color, this.current.size);
      }
      this.strokes.push(this.current);
      this.current = null;
      this.liveState = null;
      this.liveRand = null;
      this.onHistoryChange?.();
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("pointerleave", (e) => {
      if (e.buttons === 0) finish();
    });
  }

  private toLocal(e: PointerEvent): StrokePoint {
    const rect = this.paintCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp };
  }

  undo() {
    const s = this.strokes.pop();
    if (s) {
      this.redoStack.push(s);
      this.redrawAll();
      this.onHistoryChange?.();
    }
  }

  redo() {
    const s = this.redoStack.pop();
    if (s) {
      this.strokes.push(s);
      this.redrawAll();
      this.onHistoryChange?.();
    }
  }

  clear() {
    this.strokes = [];
    this.redoStack = [];
    this.redrawAll();
    this.onHistoryChange?.();
  }

  canUndo() {
    return this.strokes.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  exportCanvas(): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = this.paintCanvas.width;
    out.height = this.paintCanvas.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(this.bgCanvas, 0, 0);
    ctx.drawImage(this.paintCanvas, 0, 0);
    ctx.drawImage(this.overlayCanvas, 0, 0);
    return out;
  }
}
