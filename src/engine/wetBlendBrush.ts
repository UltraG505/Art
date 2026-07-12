import { createBrushMask } from "./brushMask";
import type { BrushImpl } from "./brushes";
import type { StrokePoint } from "./types";

const WORK_SIZE = 96;
let brushMask: HTMLCanvasElement | null = null;
function getMask(): HTMLCanvasElement {
  if (!brushMask) brushMask = createBrushMask(WORK_SIZE, 7);
  return brushMask;
}

// "Loaded brush" patch: a small square canvas holding whatever paint is
// currently on the bristles, masked to the brush shape. Painting = depositing
// this patch on the main canvas; picking up = sampling the main canvas back
// into the patch. Looping deposit->pickup every stamp is what makes color
// smear/mix into what's already there instead of flatly overwriting it.
function createLoadedPatch(color: string): HTMLCanvasElement {
  const patch = document.createElement("canvas");
  patch.width = WORK_SIZE;
  patch.height = WORK_SIZE;
  const ctx = patch.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, WORK_SIZE, WORK_SIZE);
  applyMask(patch);
  return patch;
}

function applyMask(patch: HTMLCanvasElement) {
  const ctx = patch.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(getMask(), 0, 0, WORK_SIZE, WORK_SIZE);
  ctx.globalCompositeOperation = "source-over";
}

const PICKUP_RATE = 0.55; // how much of the canvas-under-brush gets absorbed each stamp
const RELOAD_RATE = 0.05; // trickle of fresh brush color re-added each stamp

interface WetState {
  loaded: HTMLCanvasElement;
  scratch: HTMLCanvasElement;
}

function stamp(
  ctx: CanvasRenderingContext2D,
  state: WetState,
  x: number,
  y: number,
  diameter: number,
  opacity: number,
  rotation: number,
  color: string,
) {
  // 1. pick up whatever is already on the canvas at this spot (BEFORE
  // depositing) so the brush mixes with paint it's dragging over, not with
  // what it just laid down itself
  const sctx = state.scratch.getContext("2d")!;
  sctx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
  sctx.drawImage(
    ctx.canvas,
    x - diameter / 2,
    y - diameter / 2,
    diameter,
    diameter,
    0,
    0,
    WORK_SIZE,
    WORK_SIZE,
  );

  const lctx = state.loaded.getContext("2d")!;
  lctx.globalAlpha = PICKUP_RATE;
  lctx.drawImage(state.scratch, 0, 0);
  lctx.globalAlpha = RELOAD_RATE;
  lctx.fillStyle = color;
  lctx.fillRect(0, 0, WORK_SIZE, WORK_SIZE);
  lctx.globalAlpha = 1;
  applyMask(state.loaded);

  // 2. deposit the now-mixed paint at this position
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(state.loaded, -diameter / 2, -diameter / 2, diameter, diameter);
  ctx.restore();
}

export const wetBlendBrush: BrushImpl = {
  init(color: string): WetState {
    const scratch = document.createElement("canvas");
    scratch.width = WORK_SIZE;
    scratch.height = WORK_SIZE;
    return { loaded: createLoadedPatch(color), scratch };
  },

  segment(ctx, rawState, rand, prev: StrokePoint, cur: StrokePoint, color, size) {
    const state = rawState as WetState;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, cur.t - prev.t);
    const speed = dist / dt; // px/ms

    // faster strokes: thinner + more transparent (paint drags thin);
    // slower strokes: thicker + more opaque (paint pools).
    const speedFactor = Math.min(1, speed / 1.2);
    const width = size * (1.15 - 0.35 * speedFactor);
    const opacity = 0.85 - 0.35 * speedFactor;

    const spacing = Math.max(2, width * 0.14);
    const steps = Math.max(1, Math.round(dist / spacing));
    const angle = Math.atan2(dy, dx);

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const jitter = (rand() - 0.5) * width * 0.06;
      const px = prev.x + dx * t + Math.cos(angle + Math.PI / 2) * jitter;
      const py = prev.y + dy * t + Math.sin(angle + Math.PI / 2) * jitter;
      const rotation = angle + (rand() - 0.5) * 0.3;
      stamp(ctx, state, px, py, width, opacity, rotation, color);
    }
  },
};
