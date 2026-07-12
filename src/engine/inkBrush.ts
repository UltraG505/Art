import type { BrushImpl } from "./brushes";

// Thin pen line for detail work: width tapers hard with speed the way a
// fine liner starves when whipped across paper, and lingering at low speed
// occasionally bleeds a pooled dot into the surface.
interface InkState {
  color: string;
  avgSpeed: number;
}

export const inkBrush: BrushImpl = {
  init(colors): InkState {
    return { color: colors[0], avgSpeed: -1 };
  },

  segment(ctx, rawState, rand, prev, cur, _color, size) {
    const state = rawState as InkState;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, cur.t - prev.t);
    const rawSpeed = dist / dt;
    state.avgSpeed = state.avgSpeed < 0 ? rawSpeed : state.avgSpeed * 0.6 + rawSpeed * 0.4;
    const speedFactor = Math.min(1, state.avgSpeed / 1.6);

    const pr = ((prev.pr ?? 0.5) + (cur.pr ?? 0.5)) / 2;
    const width = Math.max(0.8, size * 0.22 * (1.35 - 0.9 * speedFactor) * (0.5 + pr));

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = state.color;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(cur.x, cur.y);
    ctx.stroke();

    // ink pooling when the pen loiters
    if (state.avgSpeed < 0.12 && rand() < 0.3) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = state.color;
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, width * (0.9 + rand() * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
};
