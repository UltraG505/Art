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
  // input thinning: drop move samples closer than ~1 screen pixel. Coalesced
  // events on 120Hz panels otherwise flood slow strokes with near-duplicate
  // points that cost full stamp batches each but add nothing visible.
  private liveMinDist = 1;

  // Undo/redo would otherwise have to replay every stamp of every stroke
  // ever drawn, which gets slower the longer a session runs. Instead we cache
  // a raster snapshot of the canvas from just before each recent stroke, so
  // undo/redo is a single drawImage regardless of history length. Undoing
  // further back than the cached depth falls back to a full replay.
  private undoSnapshots: { stroke: Stroke; canvas: HTMLCanvasElement }[] = [];
  private pendingSnapshot: HTMLCanvasElement | null = null;

  // "Baking": once the stroke history grows past BAKE_TRIGGER, everything
  // older than the undo-snapshot window is flattened into this raster and
  // dropped from strokes[]. Every redraw is then base image + a small tail
  // of recent strokes, so no code path ever replays an unbounded history
  // (which is what froze the app on boot and on undo in long sessions).
  private baseImage: HTMLCanvasElement | null = null;
  private baseBlob: Blob | null = null;
  private bakeGen = 0;
  // strokes already baked into baseImage whose PNG hasn't finished encoding;
  // autosave keeps carrying them so a crash in that window loses nothing
  private bakedPending: Stroke[] = [];
  private restoring = false;
  private static readonly BAKE_TRIGGER = 40;

  private dpr = Math.max(1, window.devicePixelRatio || 1);
  private lastRootW = -1;
  private lastRootH = -1;
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

  // active color loadout (1-3 colors); multi-color brushes carry all of them
  // in one stroke, single-color brushes use colors[0]
  colors: string[] = ["#7a1f2b"];
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
    // watch the container itself, not the window: the toolbar mounts after
    // the engine and changes the available height, and window resize never
    // fires for that - a stale size left the canvas overlapping the toolbar
    const ro = new ResizeObserver(() => {
      const rect = this.root.getBoundingClientRect();
      if (Math.abs(rect.width - this.lastRootW) > 0.5 || Math.abs(rect.height - this.lastRootH) > 0.5) {
        this.resize();
      }
    });
    ro.observe(this.root);

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
    this.lastRootW = rect.width;
    this.lastRootH = rect.height;
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
    this.baseImage = null;
    this.baseBlob = null;
    this.bakedPending = [];
    this.bakeGen++;
    this.resize();
    this.emitHistory();
  }

  getDoc(): PaintingDoc {
    return {
      v: 2,
      strokes: [...this.bakedPending, ...this.strokes],
      fixedSize: this.fixedSize,
      bg: this.bg,
      basePng: this.baseBlob ?? undefined,
    };
  }

  // Restores a saved session without freezing the UI: the baked base image
  // draws in one blit, then any remaining strokes replay in small batches
  // yielded across frames (matters for v1 docs, which are strokes-only).
  // Afterwards everything is re-baked, so the next boot is a single blit.
  async loadDoc(doc: PaintingDoc): Promise<void> {
    this.restoring = true;
    try {
      this.fixedSize = doc.fixedSize;
      this.bg = doc.bg || DEFAULT_BG;
      this.strokes = [];
      this.redoStack = [];
      this.undoSnapshots = [];
      this.pendingSnapshot = null;
      this.baseImage = null;
      this.baseBlob = null;
      this.bakedPending = [];
      this.bakeGen++;
      this.resize();

      if (doc.basePng) {
        try {
          const bmp = await createImageBitmap(doc.basePng);
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          c.getContext("2d")!.drawImage(bmp, 0, 0);
          bmp.close();
          this.baseImage = c;
          this.baseBlob = doc.basePng;
          this.drawBase();
        } catch {
          // corrupt base: fall back to whatever strokes we have
        }
      }

      const pending = doc.strokes ?? [];
      const BATCH = 6;
      for (let i = 0; i < pending.length; i += BATCH) {
        this.paintCtx.setTransform(this.backingScale, 0, 0, this.backingScale, 0, 0);
        for (const stroke of pending.slice(i, i + BATCH)) {
          renderStroke(this.paintCtx, stroke);
        }
        if (i + BATCH < pending.length) {
          await new Promise((r) => requestAnimationFrame(r));
        }
      }

      if (pending.length > 0) this.bakeAll(pending);
    } finally {
      this.restoring = false;
    }
    this.emitHistory();
  }

  private drawBase() {
    if (!this.baseImage) return;
    this.paintCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.paintCtx.drawImage(this.baseImage, 0, 0, this.paintCanvas.width, this.paintCanvas.height);
    this.paintCtx.setTransform(this.backingScale, 0, 0, this.backingScale, 0, 0);
  }

  // flatten the whole current paint layer into the base image; `carried`
  // rides in bakedPending until the PNG encode lands so autosave never has
  // a window where those strokes exist in neither place
  private bakeAll(carried: Stroke[]) {
    this.baseImage = this.snapshotCanvas();
    this.bakedPending = [...this.bakedPending, ...carried];
    this.strokes = [];
    this.undoSnapshots = [];
    this.encodeBase();
  }

  private encodeBase() {
    if (!this.baseImage) return;
    const gen = ++this.bakeGen;
    this.baseImage.toBlob((b) => {
      if (b && gen === this.bakeGen) {
        this.baseBlob = b;
        this.bakedPending = [];
      }
    }, "image/png");
  }

  // once the tail outgrows the trigger, everything older than the oldest
  // undo snapshot flattens into the base (undo depth is preserved exactly -
  // you can't undo past a snapshot any faster than a full replay anyway)
  private maybeBake() {
    if (this.strokes.length <= PaintEngine.BAKE_TRIGGER || this.undoSnapshots.length === 0) return;
    const oldest = this.undoSnapshots[0];
    const idx = this.strokes.findIndex((s) => s.id === oldest.stroke.id);
    if (idx <= 0) return;
    const baked = this.strokes.slice(0, idx);
    this.baseImage = oldest.canvas;
    this.strokes = this.strokes.slice(idx);
    this.bakedPending = [...this.bakedPending, ...baked];
    this.encodeBase();
  }

  hasContent(): boolean {
    return this.strokes.length > 0 || this.baseImage !== null;
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
    this.drawBase();
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
      if (this.restoring) return;
      el.setPointerCapture(e.pointerId);
      const p = this.toLocal(e);
      const seed = Math.floor(Math.random() * 2 ** 31);
      // brush size is chosen against what's on screen; scale it into canvas
      // pixels so the brush feels the same width under your finger whether
      // the canvas is screen-sized or a 2000px fixed canvas shown scaled down
      const rect = this.paintCanvas.getBoundingClientRect();
      const resolvedSize = this.size * (this.cssW / rect.width);
      this.liveMinDist = this.cssW / rect.width;
      const strokeColors = this.colors.length > 0 ? [...this.colors] : ["#7a1f2b"];
      this.current = {
        id: crypto.randomUUID(),
        brush: this.brush,
        color: strokeColors[0],
        colors: strokeColors,
        size: resolvedSize,
        seed,
        points: [p],
      };
      this.liveBrush = getBrush(this.brush);
      this.liveRand = mulberry32(seed);
      this.liveState = this.liveBrush.init(strokeColors, this.liveRand);
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
        if (Math.hypot(p.x - prev.x, p.y - prev.y) < this.liveMinDist) continue;
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
      this.maybeBake();
      this.emitHistory();
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("pointerleave", (e) => {
      if (e.buttons === 0) finish();
    });
  }

  private toLocal(e: { clientX: number; clientY: number; timeStamp: number; pressure?: number }): StrokePoint {
    const rect = this.paintCanvas.getBoundingClientRect();
    const scaleX = this.cssW / rect.width;
    const scaleY = this.cssH / rect.height;
    // pressure 0 means "not reported" on most hardware; treat as neutral
    const pr = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY, t: e.timeStamp, pr };
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
    this.baseImage = null;
    this.baseBlob = null;
    this.bakedPending = [];
    this.bakeGen++;
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
