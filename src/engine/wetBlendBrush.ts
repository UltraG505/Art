import { createBrushMask } from "./brushMask";
import type { BrushImpl } from "./brushes";

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
//
// With a multi-color loadout the patch starts as side-by-side bands, one per
// color, so a single stroke drags several pigments that streak and mix as the
// pickup loop runs - like double-loading a real brush.
function createLoadedPatch(colors: string[], transparent: boolean): HTMLCanvasElement {
  const patch = document.createElement("canvas");
  patch.width = WORK_SIZE;
  patch.height = WORK_SIZE;
  if (transparent) return patch;
  const ctx = patch.getContext("2d")!;
  const bandW = WORK_SIZE / colors.length;
  for (let i = 0; i < colors.length; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(i * bandW, 0, bandW + 1, WORK_SIZE);
  }
  if (colors.length > 1) {
    // soften the band seams so the first stamps aren't hard-edged stripes
    ctx.filter = "blur(6px)";
    ctx.drawImage(patch, 0, 0);
    ctx.filter = "none";
  }
  applyMask(patch);
  return patch;
}

function applyMask(patch: HTMLCanvasElement) {
  const ctx = patch.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(getMask(), 0, 0, WORK_SIZE, WORK_SIZE);
  ctx.globalCompositeOperation = "source-over";
}

interface WetState {
  loaded: HTMLCanvasElement;
  scratch: HTMLCanvasElement;
  colors: string[];
  reloadIndex: number;
}

interface WetOpts {
  pickupRate: number; // how much of the canvas-under-brush gets absorbed each stamp
  reloadRate: number; // trickle of fresh brush color re-added each stamp (0 = smudge)
  startTransparent: boolean; // smudge starts with nothing on the bristles
  widthMul: number;
  opacityBase: number;
}

function makeWetBrush(opts: WetOpts): BrushImpl {
  function stamp(
    ctx: CanvasRenderingContext2D,
    state: WetState,
    x: number,
    y: number,
    diameter: number,
    opacity: number,
    rotation: number,
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
    lctx.globalAlpha = opts.pickupRate;
    lctx.drawImage(state.scratch, 0, 0);
    if (opts.reloadRate > 0) {
      // cycle through the loadout so every color keeps feeding the stroke
      lctx.globalAlpha = opts.reloadRate;
      lctx.fillStyle = state.colors[state.reloadIndex % state.colors.length];
      state.reloadIndex++;
      lctx.fillRect(0, 0, WORK_SIZE, WORK_SIZE);
    }
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

  return {
    init(colors): WetState {
      const scratch = document.createElement("canvas");
      scratch.width = WORK_SIZE;
      scratch.height = WORK_SIZE;
      return {
        loaded: createLoadedPatch(colors, opts.startTransparent),
        scratch,
        colors,
        reloadIndex: 0,
      };
    },

    segment(ctx, rawState, rand, prev, cur, _color, size) {
      const state = rawState as WetState;
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(1, cur.t - prev.t);
      const speed = dist / dt; // px/ms

      // faster strokes: thinner + more transparent (paint drags thin);
      // slower strokes: thicker + more opaque (paint pools).
      const speedFactor = Math.min(1, speed / 1.2);
      const pr = ((prev.pr ?? 0.5) + (cur.pr ?? 0.5)) / 2;
      const width = size * opts.widthMul * (1.15 - 0.35 * speedFactor) * (0.6 + pr * 0.8);
      const opacity = opts.opacityBase - 0.35 * speedFactor;

      const spacing = Math.max(2, width * 0.14);
      const steps = Math.max(1, Math.round(dist / spacing));
      const angle = Math.atan2(dy, dx);

      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const jitter = (rand() - 0.5) * width * 0.06;
        const px = prev.x + dx * t + Math.cos(angle + Math.PI / 2) * jitter;
        const py = prev.y + dy * t + Math.sin(angle + Math.PI / 2) * jitter;
        const rotation = angle + (rand() - 0.5) * 0.3;
        stamp(ctx, state, px, py, width, opacity, rotation);
      }
    },
  };
}

export const wetBlendBrush = makeWetBrush({
  pickupRate: 0.55,
  reloadRate: 0.05,
  startTransparent: false,
  widthMul: 1,
  opacityBase: 0.85,
});

// deposits no pigment of its own: picks up whatever is on the canvas and
// drags it along the stroke - a pure finger-smudge through wet paint
export const smudgeBrush = makeWetBrush({
  pickupRate: 0.8,
  reloadRate: 0,
  startTransparent: true,
  widthMul: 1.1,
  opacityBase: 0.9,
});
