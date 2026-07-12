import { mulberry32 } from "./random";
import type { Stroke, StrokePoint, BrushId } from "./types";
import { wetBlendBrush, smudgeBrush } from "./wetBlendBrush";
import { chalkBrush } from "./chalkBrush";
import { glowBrush } from "./glowBrush";
import { flowBrush } from "./flowBrush";
import { inkBrush } from "./inkBrush";

export type RandFn = () => number;

// A brush is a stateful stamping process: init() builds per-stroke state
// (loaded paint, bristle lanes, tinted stamps, ...) from the color loadout,
// segment() advances it between two consecutive input points. Live drawing
// and replay (undo fallback, resize, gallery load) both drive this same
// interface with the same seeded RNG - init consumes random values first,
// segments continue the sequence - so they produce identical pixels.
export interface BrushImpl {
  init(colors: string[], rand: RandFn): unknown;
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
  flow: flowBrush,
  chalk: chalkBrush,
  glow: glowBrush,
  ink: inkBrush,
  smudge: smudgeBrush,
};

export function getBrush(id: BrushId): BrushImpl {
  return BRUSHES[id] ?? BRUSHES.wetBlend;
}

export function strokeColors(stroke: Stroke): string[] {
  return stroke.colors && stroke.colors.length > 0 ? stroke.colors : [stroke.color];
}

export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const brush = getBrush(stroke.brush);
  const rand = mulberry32(stroke.seed);
  const state = brush.init(strokeColors(stroke), rand);
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
