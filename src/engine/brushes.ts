import { mulberry32 } from "./random";
import type { Stroke, StrokePoint, BrushId } from "./types";
import { wetBlendBrush } from "./wetBlendBrush";
import { chalkBrush } from "./chalkBrush";
import { glowBrush } from "./glowBrush";

export type RandFn = () => number;

// A brush is a stateful stamping process: init() builds per-stroke state
// (loaded paint, tinted stamps, ...), segment() advances it between two
// consecutive input points. Live drawing and replay (undo fallback, resize,
// gallery load) both drive this same interface with the same seeded RNG, so
// they produce identical pixels.
export interface BrushImpl {
  init(color: string): unknown;
  segment(
    ctx: CanvasRenderingContext2D,
    state: unknown,
    rand: RandFn,
    prev: StrokePoint,
    cur: StrokePoint,
    color: string,
    size: number,
  ): void;
}

const BRUSHES: Record<BrushId, BrushImpl> = {
  wetBlend: wetBlendBrush,
  chalk: chalkBrush,
  glow: glowBrush,
};

export function getBrush(id: BrushId): BrushImpl {
  return BRUSHES[id] ?? BRUSHES.wetBlend;
}

export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const brush = getBrush(stroke.brush);
  const state = brush.init(stroke.color);
  const rand = mulberry32(stroke.seed);
  const pts = stroke.points;
  if (pts.length === 0) return;

  if (pts.length === 1) {
    brush.segment(ctx, state, rand, pts[0], pts[0], stroke.color, stroke.size);
    return;
  }

  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    brush.segment(ctx, state, rand, prev, pts[i], stroke.color, stroke.size);
    prev = pts[i];
  }
}
