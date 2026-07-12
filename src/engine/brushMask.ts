import { mulberry32 } from "./random";

// An organic, irregular soft-edged "bristle clump" alpha mask, rendered once
// and reused for every stamp. A perfect circle reads as digital/airbrush;
// overlapping offset blobs + blur gives a ragged, hand-loaded-brush edge.
export function createBrushMask(size = 160, seed = 7): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(seed);
  const cx = size / 2;
  const cy = size / 2;
  const baseR = size * 0.34;

  ctx.filter = "blur(4px)";
  const blobCount = 9;
  for (let i = 0; i < blobCount; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = rand() * baseR * 0.55;
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist;
    const r = baseR * (0.55 + rand() * 0.6);
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    const alpha = 0.55 + rand() * 0.35;
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = "none";

  return canvas;
}
