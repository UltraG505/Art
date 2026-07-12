import type { BrushImpl } from "./brushes";
import { lighten, darken } from "./color";

// The brush is modeled as individual bristle "lanes" spread across its width.
// Each lane draws its own continuous filament that follows the stroke curve,
// with its own color (drawn from the multi-color loadout), thickness, alpha
// and dropout rate. Lanes shaded lighter on one side and darker on the other
// read as raised ridges of paint catching light - the "bumpy" combed look of
// a loaded flat brush or squeegee pulled through wet paint.
interface Lane {
  off: number; // -0.5..0.5 position across brush width
  w: number; // thickness relative to base lane width
  color: string;
  alpha: number;
  phase: number; // phase for smooth alpha undulation along the stroke
  dropout: number; // chance per segment to skip (broken streak)
}

interface FlowState {
  lanes: Lane[];
  travelled: number;
  avgSpeed: number;
}

const LANE_COUNT = 18;

export const flowBrush: BrushImpl = {
  init(colors, rand): FlowState {
    const lanes: Lane[] = [];

    // wide soft "body" lanes first: they give the stroke the mass of a
    // loaded brush, so the streak lanes on top read as ridges in the paint
    // rather than separate pinstripes
    const bodyCount = 5;
    for (let i = 0; i < bodyCount; i++) {
      const off = ((i + 0.5) / bodyCount - 0.5) * 0.82 + (rand() - 0.5) * 0.06;
      lanes.push({
        off,
        w: 3.2 + rand() * 1.6,
        color: colors[Math.floor(rand() * colors.length)],
        alpha: 0.3 + rand() * 0.2,
        phase: rand() * Math.PI * 2,
        dropout: 0,
      });
    }

    for (let i = 0; i < LANE_COUNT; i++) {
      const off = (i + 0.5) / LANE_COUNT - 0.5 + (rand() - 0.5) * 0.05;
      const base = colors[Math.floor(rand() * colors.length)];
      // cylindrical shading across the stroke: one side catches light, the
      // other falls into shadow, plus per-lane jitter so ridges feel uneven
      const shade = -off * 0.5 + (rand() - 0.5) * 0.35;
      const color = shade >= 0 ? lighten(base, Math.min(0.55, shade)) : darken(base, Math.min(0.5, -shade));
      // edge lanes are thinner and fainter for a ragged boundary
      const edge = 1 - Math.abs(off) * 1.6;
      lanes.push({
        off,
        w: (0.55 + rand() * 1.25) * Math.max(0.35, edge),
        color,
        alpha: (0.4 + rand() * 0.5) * Math.max(0.4, edge),
        phase: rand() * Math.PI * 2,
        dropout: 0.015 + rand() * 0.05,
      });
    }

    // a few bright filaments and dark creases riding on top sell the relief
    for (let k = 0; k < 3; k++) {
      lanes.push({
        off: (rand() - 0.5) * 0.85,
        w: 0.22 + rand() * 0.35,
        color: lighten(colors[Math.floor(rand() * colors.length)], 0.55 + rand() * 0.3),
        alpha: 0.28 + rand() * 0.3,
        phase: rand() * Math.PI * 2,
        dropout: 0.08 + rand() * 0.1,
      });
    }
    for (let k = 0; k < 2; k++) {
      lanes.push({
        off: (rand() - 0.5) * 0.85,
        w: 0.2 + rand() * 0.3,
        color: darken(colors[Math.floor(rand() * colors.length)], 0.4 + rand() * 0.25),
        alpha: 0.25 + rand() * 0.25,
        phase: rand() * Math.PI * 2,
        dropout: 0.08 + rand() * 0.1,
      });
    }

    return { lanes, travelled: 0, avgSpeed: -1 };
  },

  segment(ctx, rawState, rand, prev, cur, _color, size) {
    const state = rawState as FlowState;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 0.01) {
      // a bare tap: put down a soft dab so it isn't invisible
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = state.lanes[0]?.color ?? _color;
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const dt = Math.max(1, cur.t - prev.t);
    const rawSpeed = dist / dt;
    state.avgSpeed = state.avgSpeed < 0 ? rawSpeed : state.avgSpeed * 0.65 + rawSpeed * 0.35;
    const speedFactor = Math.min(1, state.avgSpeed / 1.4);

    const pr = ((prev.pr ?? 0.5) + (cur.pr ?? 0.5)) / 2;
    const width = size * (1.05 - 0.3 * speedFactor) * (0.6 + pr * 0.8);

    const nx = -dy / dist;
    const ny = dx / dist;
    const laneW = width / LANE_COUNT;

    ctx.save();
    ctx.lineCap = "round";
    for (const lane of state.lanes) {
      if (rand() < lane.dropout) continue;
      const wobble = (rand() - 0.5) * width * 0.025;
      const o = lane.off * width + wobble;
      // slow undulation along the stroke length so streaks breathe
      const alphaMod = 0.72 + 0.28 * Math.sin(lane.phase + state.travelled * 0.02);
      ctx.globalAlpha = lane.alpha * alphaMod * (1 - 0.3 * speedFactor);
      ctx.strokeStyle = lane.color;
      ctx.lineWidth = Math.max(0.6, laneW * lane.w);
      ctx.beginPath();
      ctx.moveTo(prev.x + nx * o, prev.y + ny * o);
      ctx.lineTo(cur.x + nx * o, cur.y + ny * o);
      ctx.stroke();
    }
    ctx.restore();
    state.travelled += dist;
  },
};
