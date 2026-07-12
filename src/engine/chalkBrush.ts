import { mulberry32 } from "./random";
import type { BrushImpl } from "./brushes";

const STAMP_SIZE = 64;

// Speckle mask shared by all chalk strokes: lots of tiny dots of varying
// alpha, denser toward the center. Stamped with random rotation it reads as
// dry pigment catching the tooth of the paper rather than a solid line.
let speckleMask: HTMLCanvasElement | null = null;
function getSpeckleMask(): HTMLCanvasElement {
  if (speckleMask) return speckleMask;
  const c = document.createElement("canvas");
  c.width = STAMP_SIZE;
  c.height = STAMP_SIZE;
  const ctx = c.getContext("2d")!;
  const rand = mulberry32(1234);
  const cx = STAMP_SIZE / 2;
  const r = STAMP_SIZE * 0.46;
  for (let i = 0; i < 340; i++) {
    // uniform in disc, biased slightly to center via sqrt-less radius draw
    const a = rand() * Math.PI * 2;
    const d = rand() * r;
    const x = cx + Math.cos(a) * d;
    const y = cx + Math.sin(a) * d;
    const dotR = 0.5 + rand() * 1.6;
    // fade dots out toward the edge for a ragged, non-circular boundary
    const edge = 1 - d / r;
    ctx.fillStyle = `rgba(255,255,255,${(0.25 + rand() * 0.75) * Math.min(1, edge * 2.5)})`;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  speckleMask = c;
  return c;
}

function tintedStamp(color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = STAMP_SIZE;
  c.height = STAMP_SIZE;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, STAMP_SIZE, STAMP_SIZE);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(getSpeckleMask(), 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return c;
}

interface ChalkState {
  stamp: HTMLCanvasElement;
}

export const chalkBrush: BrushImpl = {
  init(color: string): ChalkState {
    return { stamp: tintedStamp(color) };
  },

  segment(ctx, rawState, rand, prev, cur, _color, size) {
    const state = rawState as ChalkState;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, cur.t - prev.t);
    const speed = dist / dt;

    // chalk reads best thinner than the paint brush; fast flicks skip and
    // lighten like a real pastel dragged quickly across paper
    const speedFactor = Math.min(1, speed / 1.5);
    const width = size * 0.55 * (1.05 - 0.3 * speedFactor);
    const opacity = 0.75 - 0.4 * speedFactor;

    const spacing = Math.max(1.5, width * 0.22);
    const steps = Math.max(1, Math.round(dist / spacing));

    ctx.save();
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const jx = (rand() - 0.5) * width * 0.18;
      const jy = (rand() - 0.5) * width * 0.18;
      const px = prev.x + dx * t + jx;
      const py = prev.y + dy * t + jy;
      const rot = rand() * Math.PI * 2;
      const scale = 0.85 + rand() * 0.3;
      ctx.globalAlpha = opacity * (0.7 + rand() * 0.3);
      ctx.translate(px, py);
      ctx.rotate(rot);
      const d = width * scale;
      ctx.drawImage(state.stamp, -d / 2, -d / 2, d, d);
      ctx.rotate(-rot);
      ctx.translate(-px, -py);
    }
    ctx.restore();
  },
};
