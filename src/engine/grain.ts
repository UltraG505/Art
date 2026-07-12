import { mulberry32 } from "./random";

// Procedurally generated paper/canvas grain, tiled as a background wash and
// again as a low-opacity multiply overlay on top of everything. Without this
// even a hand-drawn stroke reads as a flat digital fill.
export function createGrainTile(size = 256, seed = 42): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(seed);

  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 200 + rand() * 55;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  // a few soft fiber-like streaks for texture beyond pure noise
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = rand() > 0.5 ? "#000" : "#fff";
    ctx.lineWidth = rand() * 1.2;
    ctx.beginPath();
    const x0 = rand() * size;
    const y0 = rand() * size;
    const len = 6 + rand() * 18;
    const angle = rand() * Math.PI * 2;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(angle) * len, y0 + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  return canvas;
}

export function paintGrainBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tile: HTMLCanvasElement,
  paperColor: string,
) {
  ctx.fillStyle = paperColor;
  ctx.fillRect(0, 0, w, h);
  const pattern = ctx.createPattern(tile, "repeat");
  if (pattern) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
