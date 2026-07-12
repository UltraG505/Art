import type { Stroke, StrokePoint, BrushId, PaintingDoc } from "./types";
import { renderStroke, getBrush, type BrushImpl, type RandFn } from "./brushes";
import { mulberry32 } from "./random";
import { createGrainTile, paintGrainBackground } from "./grain";

export const DEFAULT_BG = "#e8e2d6";

// Total pixel budget for undo snapshots. Each snapshot is a full raster copy
// of the paint layer (w*h*4 bytes), so on large fixed-size canvases keeping a
// fixed count would eat hundreds of MB and crash mobile tabs; instead the
// snapshot depth adapts to canvas size within this budget.
const SNAPSHOT_BYTE_BUDGET = 96 * 1024 * 1024;

export class PaintEngine {
  readonly root: HTMLDivElement;
  private frame: HTMLDivElement;
  private bgCanvas: HTMLCanvasElement;
  private paintCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private paintCtx: CanvasRenderingContext2D;
  private grainTile: HTMLCanvasElement;

  private strokes: Stroke[] = [];
  private redoStack: Stroke[] = [];
  private current: Stroke | null = null;
  private liveBrush: BrushImpl | null = null;
  private liveState: unknown = null;
  private liveRand: RandFn | null = null;

  // Undo/redo would otherwise have to replay every stamp of every stroke
  // ever drawn, which gets slower the longer a session runs. Instead we cache
  // a raster snapshot of the canvas from just before each recent stroke, so
  // undo/redo is a single drawImage regardless of history length. Undoing
  // further back than the cached depth falls back to a full replay.
  private undoSnapshots: { stroke: Stroke; canvas: HTMLCanvasElement }[] = [];
  private pendingSnapshot: HTMLCanvasElement | null = null;

  private dpr = Math.max(1, window.devicePixelRatio || 1);
  // "logical" size: the coordinate space strokes are recorded/rendered in.
  // Equals the on-screen viewport unless a fixed canvas size is chosen, in
  // which case the canvas is displayed scaled-to-fit but strokes/backing
  // store still use these exact logical dimensions.
  private cssW = 0;
  private cssH = 0;
  private fixedSize: { w: number; h: number } | null = null;
  // backing-store pixels per logical pixel: devicePixelRatio when filling the
  // screen (for crisp rendering), or exactly 1 for a fixed size so exports
  // come out at precisely the requested pixel dimensions.
  private backingScale = this.dpr;

  color = "#7a1f2b";
  size = 34;
  brush: BrushId = "wetBlend";
  bg = DEFAULT_BG;

  private historyListeners: (() => void)[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "paint-stack";

    this.frame = document.createElement("div");
    this.frame.className = "canvas-frame";

    this.bgCanvas = document.createElement("canvas");
    this.bgCanvas.className = "paint-layer";
    this.paintCanvas = document.createElement("canvas");
    this.paintCanvas.className = "paint-layer";
    this.overlayCanvas = document.createElement("canvas");
    this.overlayCanvas.className = "paint-layer paint-layer--overlay";

    this.frame.append(this.bgCanvas, this.paintCanvas, this.overlayCanvas);
    this.root.append(this.frame);
    container.appendChild(this.root);

    this.paintCtx = this.paintCanvas.getContext("2d")!;
    this.grainTile = createGrainTile();

    this.resize();
    window.addEventListener("resize", () => this.resize());

    this.bindPointerEvents();
  }

  onHistory(cb: () => void) {
    this.historyListeners.push(cb);
  }

  private emitHistory() {
    for (const cb of this.historyListeners) cb();
  }

  private maxSnapshots(): number {
    const bytes = this.paintCanvas.width * this.paintCanvas.height * 4 || 1;
    return Math.max(4, Math.min(24, Math.floor(SNAPSHOT_BYTE_BUDGET / bytes)));
  }

  private pushSnapshot(stroke: Stroke, canvas: HTMLCanvasElement) {
    this.undoSnapshots.push({ stroke, canvas });
    const max = this.maxSnapshots();
    while (this.undoSnapshots.length > max) this.undoSnapshots.shift();
  }

  private resize() {
    const rect = this.root.getBoundingClientRect();
    let displayW: number;
    let displayH: number;

    if (this.fixedSize) {
      const { w, h } = this.fixedSize;
      const fitScale = Math.min(rect.width / w, rect.height / h);
      displayW = w * fitScale;
      displayH = h * fitScale;
      this.cssW = w;
      this.cssH = h;
      this.backingScale = 1;
    } else {
      displayW = rect.width;
      displayH = rect.height;
      this.cssW = rect.width;
      this.cssH = rect.height;
      this.backingScale = this.dpr;
    }

    this.frame.style.width = `${displayW}px`;
    this.frame.style.height = `${displayH}px`;

    for (const c of [this.bgCanvas, this.paintCanvas, this.overlayCanvas]) {
      c.width = Math.round(this.cssW * this.backingScale);
      c.height = Math.round(this.cssH * this.backingScale);
    }
    this.redrawAll();
  }

  // Starts a fresh canvas. Pass w/h to fix the canvas to that exact pixel
  // resolution (displayed scaled-to-fit); omit both to fill the screen.
  newCanvas(w?: number, h?: number, bg?: string) {
    this.fixedSize = w && h ? { w, h } : null;
    this.bg = bg ?? DEFAULT_BG;
    this.strokes = [];
    this.redoStack = [];
    this.undoSnapshots = [];
    this.pendingSnapshot = null;
    this.resize();
    this.emitHistory();
  }

  getDoc(): PaintingDoc {
    return { v: 1, strokes: this.strokes, fixedSize: this.fixedSize, bg: this.bg };
  }

  loadDoc(doc: PaintingDoc) {
    this.fixedSize = doc.fixedSize;
    this.bg = doc.bg || DEFAULT_BG;
    this.strokes = doc.strokes ?? [];
    this.redoStack = [];
    this.undoSnapshots = [];
    this.pendingSnapshot = null;
    this.resize();
    this.emitHistory();
  }

  hasContent(): boolean {
    return this.strokes.length > 0;
  }

  private redrawAll() {
    const bgCtx = this.bgCanvas.getContext("2d")!;
    bgCtx.setTransform(this.backingScale, 0, 0, this.backingScale, 0, 0);
    paintGrainBackground(bgCtx, this.cssW, this.cssH, this.grainTile, this.bg);

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

    this.paintCtx.setTransform(this.backingScale, 0, 0, this.backingScale, 0, 0);
    this.paintCtx.clearRect(0, 0, this.cssW, this.cssH);
    for (const stroke of this.strokes) {
      renderStroke(this.paintCtx, stroke);
    }

    // a full replay invalidates any snapshots (they're pixel copies at the
    // pre-replay canvas size/content), so fast undo only resumes once new
    // strokes are drawn after this
    this.undoSnapshots = [];
  }

  private snapshotCanvas(): HTMLCanvasElement {
    const snap = document.createElement("canvas");
    snap.width = this.paintCanvas.width;
    snap.height = this.paintCanvas.height;
    snap.getContext("2d")!.drawImage(this.paintCanvas, 0, 0);
    return snap;
  }

  private restoreSnapshot(snap: HTMLCanvasElement) {
    this.paintCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.paintCtx.clearRect(0, 0, this.paintCanvas.width, this.paintCanvas.height);
    this.paintCtx.drawImage(snap, 0, 0);
    this.paintCtx.setTransform(this.backingScale, 0, 0, this.backingScale, 0, 0);
  }

  private bindPointerEvents() {
    const el = this.paintCanvas;
    el.style.touchAction = "none";

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      const p = this.toLocal(e);
      const seed = Math.floor(Math.random() * 2 ** 31);
      // brush size is chosen against what's on screen; scale it into canvas
      // pixels so the brush feels the same width under your finger whether
      // the canvas is screen-sized or a 2000px fixed canvas shown scaled down
      const rect = this.paintCanvas.getBoundingClientRect();
      const resolvedSize = this.size * (this.cssW / rect.width);
      this.current = {
        id: crypto.randomUUID(),
        brush: this.brush,
        color: this.color,
        size: resolvedSize,
        seed,
        points: [p],
      };
      this.liveBrush = getBrush(this.brush);
      this.liveState = this.liveBrush.init(this.color);
      this.liveRand = mulberry32(seed);
      this.redoStack = [];
      this.pendingSnapshot = this.snapshotCanvas();
    });

    el.addEventListener("pointermove", (e) => {
      if (!this.current || !this.liveBrush || !this.liveRand) return;
      // coalesced events carry the full-rate touch samples Android collects
      // between frames; using them makes fast curves smooth instead of angular
      const events = typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents().length > 0
        ? e.getCoalescedEvents()
        : [e];
      for (const ev of events) {
        const prev = this.current.points[this.current.points.length - 1];
        const p = this.toLocal(ev);
        if (p.x === prev.x && p.y === prev.y) continue;
        this.current.points.push(p);
        this.liveBrush.segment(this.paintCtx, this.liveState, this.liveRand, prev, p, this.current.color, this.current.size);
      }
    });

    const finish = () => {
      if (!this.current) return;
      if (this.current.points.length === 1 && this.liveBrush && this.liveRand) {
        const p = this.current.points[0];
        this.liveBrush.segment(this.paintCtx, this.liveState, this.liveRand, p, p, this.current.color, this.current.size);
      }
      this.strokes.push(this.current);
      if (this.pendingSnapshot) {
        this.pushSnapshot(this.current, this.pendingSnapshot);
      }
      this.pendingSnapshot = null;
      this.current = null;
      this.liveBrush = null;
      this.liveState = null;
      this.liveRand = null;
      this.emitHistory();
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("pointerleave", (e) => {
      if (e.buttons === 0) finish();
    });
  }

  private toLocal(e: { clientX: number; clientY: number; timeStamp: number }): StrokePoint {
    const rect = this.paintCanvas.getBoundingClientRect();
    const scaleX = this.cssW / rect.width;
    const scaleY = this.cssH / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY, t: e.timeStamp };
  }

  undo() {
    const s = this.strokes[this.strokes.length - 1];
    if (!s) return;

    const top = this.undoSnapshots[this.undoSnapshots.length - 1];
    if (top && top.stroke === s) {
      this.undoSnapshots.pop();
      this.strokes.pop();
      this.redoStack.push(s);
      this.restoreSnapshot(top.canvas);
    } else {
      // beyond the cached undo depth: fall back to a full replay
      this.strokes.pop();
      this.redoStack.push(s);
      this.redrawAll();
    }
    this.emitHistory();
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s) return;

    const snap = this.snapshotCanvas();
    this.paintCtx.setTransform(this.backingScale, 0, 0, this.backingScale, 0, 0);
    renderStroke(this.paintCtx, s);

    this.strokes.push(s);
    this.pushSnapshot(s, snap);
    this.emitHistory();
  }

  clear() {
    this.strokes = [];
    this.redoStack = [];
    this.undoSnapshots = [];
    this.pendingSnapshot = null;
    this.redrawAll();
    this.emitHistory();
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
