import type { BrushImpl } from "./brushes";

const STAMP_SIZE = 64;

// Soft radial falloff stamp, tinted per stroke. Drawn with "lighter"
// (additive) compositing so overlapping stamps build up brightness the way
// long-exposure light trails do; crossings glow hotter than single passes.
function makeGlowStamp(color: string, coreStop: number, alpha: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = STAMP_SIZE;
  c.height = STAMP_SIZE;
  const ctx = c.getContext("2d")!;
  const half = STAMP_SIZE / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, color);
  grad.addColorStop(coreStop, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, STAMP_SIZE, STAMP_SIZE);
  return c;
}

interface GlowState {
  halos: HTMLCanvasElement[];
  core: HTMLCanvasElement;
  avgSpeed: number;
  haloIndex: number;
}

export const glowBrush: BrushImpl = {
  init(colors): GlowState {
    return {
      halos: colors.map((c) => makeGlowStamp(c, 0.05, 0.14)),
      core: makeGlowStamp("#ffffff", 0.1, 0.5),
      avgSpeed: -1,
      haloIndex: 0,
    };
  },

  segment(ctx, rawState, _rand, prev, cur, _color, size) {
    const state = rawState as GlowState;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, cur.t - prev.t);
    // smooth the per-segment speed: raw values jitter between input events,
    // which reads as bright/dim banding along the trail
    const rawSpeed = dist / dt;
    state.avgSpeed = state.avgSpeed < 0 ? rawSpeed : state.avgSpeed * 0.65 + rawSpeed * 0.35;
    const speed = state.avgSpeed;

    // moving fast stretches the light thin and dim, like a quick swing of a
    // torch in a long exposure; lingering burns a hot bright spot
    const speedFactor = Math.min(1, speed / 1.5);
    const pr = ((prev.pr ?? 0.5) + (cur.pr ?? 0.5)) / 2;
    const prMul = 0.6 + pr * 0.8;
    const haloD = size * 2.1 * (1 - 0.4 * speedFactor) * prMul;
    const coreD = size * 0.5 * (1 - 0.45 * speedFactor) * prMul;
    const intensity = 1 - 0.55 * speedFactor;

    const spacing = Math.max(1.5, size * 0.1);
    const steps = Math.min(48, Math.max(1, Math.round(dist / spacing)));

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const px = prev.x + dx * t;
      const py = prev.y + dy * t;
      // with a multi-color loadout the halo hue cycles slowly along the
      // trail, like an aurora shifting color
      const halo = state.halos[Math.floor(state.haloIndex / 6) % state.halos.length];
      state.haloIndex++;
      ctx.globalAlpha = intensity;
      ctx.drawImage(halo, px - haloD / 2, py - haloD / 2, haloD, haloD);
      ctx.globalAlpha = intensity * 0.8;
      ctx.drawImage(state.core, px - coreD / 2, py - coreD / 2, coreD, coreD);
    }
    ctx.restore();
  },
};
