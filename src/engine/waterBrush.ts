import type { BrushImpl } from "./brushes";
import { hexToRgb } from "./color";
import { mulberry32 } from "./random";
import { wetBlendBrush } from "./wetBlendBrush";

// Wet paint that dries like watercolor.
//
// The body of the stroke is the ordinary paint brush - loaded bristles that
// pick up and smear whatever is already on the canvas - so the interior
// keeps its grain and its blending. What is added is the drying edge: water
// carries pigment to the perimeter of the wet area, evaporates, and strands
// it there as one dark meandering tide line, with a soft halo bleeding out
// past the pigment.
//
// The rim has to follow the boundary of the WHOLE wet area, not of each dab,
// or every dab's outline shows through the middle and the stroke turns
// hairy. So the paint goes onto an offscreen copy of the canvas while a
// parallel mask records the wet region, a second copy of that mask is kept
// slightly shrunk, and the difference between them is exactly the outer
// contour. The visible canvas is rebuilt from the paint layer each pass,
// which is what lets a later part of the stroke dissolve the rim it now
// covers, the way fresh water reactivates a drying edge.

interface Lobe {
  freq: number;
  amp: number;
  phase: number;
}

interface Layers {
  // canvas content at stroke start with this stroke's paint stamped into
  // it; the visible canvas is re-blitted from here
  paint: HTMLCanvasElement;
  wet: HTMLCanvasElement; // wet region, opaque so overlaps stay flat
  core: HTMLCanvasElement; // same region shrunk - eroded copy
  tide: HTMLCanvasElement; // overtaken drying fronts left inside the stain
  tmp: HTMLCanvasElement;
  tmp2: HTMLCanvasElement;
  pattern: CanvasPattern | null;
  // The region masks run at reduced resolution. A wash edge is soft anyway,
  // so full canvas resolution buys nothing visible, while on a large canvas
  // the dabs scale up with it and every pass would push millions of pixels
  // per input event.
  scale: number;
}

interface Dirty {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface WaterState {
  paint: unknown; // the paint brush's own per-stroke state
  colors: string[];
  lobes: Lobe[];
  reachFactor: number;
  spin: number;
  travelled: number;
  sinceBloom: number;
  dark: boolean;
  layers: Layers | null;
  // Dabs land in the offscreen layers immediately, but the visible rebuild
  // is coalesced into one pass per animation frame - touch panels deliver
  // input far faster than the display refreshes, and rebuilding per event
  // redid the same patch several times before anything was shown.
  dirty: Dirty | null;
  raf: number | null;
}

const POINTS = 36;
const CORE = 0.91; // eroded radius as a fraction of the wet radius
const LAYER_MAX = 1400;
// diffusion radii, in reduced-layer pixels
const BLUR_RIM = 5;
const BLUR_WASH = 3.5;

function isDark(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.4;
}

// Soft blotchy tile used to eat unevenly into the rim. A real tide line is
// heavy where the paper held a bead of water and almost absent elsewhere; a
// perfectly even contour is the giveaway that something was drawn, not dried.
let mottleTile: HTMLCanvasElement | null = null;
function getMottle(): HTMLCanvasElement {
  if (mottleTile) return mottleTile;
  const size = 220;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const rand = mulberry32(9182);
  ctx.filter = "blur(9px)";
  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.05 + rand() * 0.16);
    ctx.fillStyle = `rgba(0,0,0,${0.2 + rand() * 0.55})`;
    ctx.beginPath();
    // wrap-around copies keep the tile seamless
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ]) {
      ctx.moveTo(x + ox + r, y + oy);
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.filter = "none";
  mottleTile = c;
  return c;
}

function makeLayer(w: number, h: number, t: DOMMatrix): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.setTransform(t);
  return c;
}

// Strokes are sequential, so one set of layers can serve all of them. Left
// to allocate per stroke, a big canvas meant tens of megabytes of fresh
// buffers every time the finger came down.
let pool: (Layers & { w: number; h: number }) | null = null;

function takeLayers(canvas: HTMLCanvasElement, t: DOMMatrix): Layers {
  const ls = Math.min(1, LAYER_MAX / Math.max(canvas.width, canvas.height));
  const lw = Math.max(1, Math.round(canvas.width * ls));
  const lh = Math.max(1, Math.round(canvas.height * ls));
  // dabs are addressed in logical units, so the mask transform is the canvas
  // transform with the downscale folded in
  const lt = new DOMMatrix([t.a * ls, 0, 0, t.d * ls, 0, 0]);

  if (!pool || pool.w !== canvas.width || pool.h !== canvas.height) {
    pool = {
      w: canvas.width,
      h: canvas.height,
      paint: makeLayer(canvas.width, canvas.height, t),
      wet: makeLayer(lw, lh, lt),
      core: makeLayer(lw, lh, lt),
      tide: makeLayer(lw, lh, lt),
      tmp: makeLayer(64, 64, new DOMMatrix()),
      tmp2: makeLayer(64, 64, new DOMMatrix()),
      pattern: null,
      scale: ls,
    };
  } else {
    for (const layer of [pool.wet, pool.core, pool.tide]) {
      const c = layer.getContext("2d")!;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, layer.width, layer.height);
      c.setTransform(lt);
    }
    pool.scale = ls;
  }

  // the paint layer starts as the canvas, so the bristles pick up the
  // artwork already there exactly as the paint brush does on the canvas
  const pctx = pool.paint.getContext("2d")!;
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.clearRect(0, 0, pool.paint.width, pool.paint.height);
  pctx.drawImage(canvas, 0, 0);
  pctx.setTransform(t);
  return pool;
}

function blobPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  lobes: Lobe[],
  rotation: number,
  wobble: number,
) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    const th = (i / POINTS) * Math.PI * 2;
    let k = 1;
    for (const l of lobes) k += l.amp * wobble * Math.sin(l.freq * (th + rotation) + l.phase);
    const rr = r * Math.max(0.2, k);
    xs.push(x + Math.cos(th) * rr);
    ys.push(y + Math.sin(th) * rr);
  }
  // run a quadratic through the midpoints so the outline curves instead of
  // showing the polygon facets a straight lineTo chain would leave
  ctx.beginPath();
  ctx.moveTo((xs[POINTS - 1] + xs[0]) / 2, (ys[POINTS - 1] + ys[0]) / 2);
  for (let i = 0; i < POINTS; i++) {
    const n = (i + 1) % POINTS;
    ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[n]) / 2, (ys[i] + ys[n]) / 2);
  }
  ctx.closePath();
}

// Repaints the dirty patch: the painted stroke, then the water that spread
// past the pigment, then the tide line stranded at the boundary.
function composite(ctx: CanvasRenderingContext2D, state: WaterState) {
  const L = state.layers;
  const d = state.dirty;
  if (!L || !d) return;
  state.dirty = null;

  const canvas = ctx.canvas;
  const scale = ctx.getTransform().a || 1;
  const rx = Math.max(0, Math.floor(d.minX * scale));
  const ry = Math.max(0, Math.floor(d.minY * scale));
  const rw = Math.min(canvas.width - rx, Math.ceil((d.maxX - d.minX) * scale) + 2);
  const rh = Math.min(canvas.height - ry, Math.ceil((d.maxY - d.minY) * scale) + 2);
  if (rw <= 0 || rh <= 0) return;

  // the same patch expressed in the reduced-resolution masks
  const ls = L.scale;
  const lx = Math.max(0, Math.floor(rx * ls));
  const ly = Math.max(0, Math.floor(ry * ls));
  const lw = Math.max(1, Math.min(L.wet.width - lx, Math.ceil(rw * ls)));
  const lh = Math.max(1, Math.min(L.wet.height - ly, Math.ceil(rh * ls)));

  // Diffusion happens on the reduced patch and is magnified on the way back,
  // which is cheap and keeps the softness proportional on a large canvas.
  // The patch is grown by the blur reach before the masks are sampled, or
  // the blur would fade into the empty area outside the crop and leave a
  // seam against the previously composited patch.
  const pad = Math.ceil(BLUR_RIM + BLUR_WASH) + 2;
  const ex = Math.max(0, lx - pad);
  const ey = Math.max(0, ly - pad);
  const ew = Math.max(1, Math.min(L.wet.width - ex, lw + (lx - ex) + pad));
  const eh = Math.max(1, Math.min(L.wet.height - ey, lh + (ly - ey) + pad));
  const ox = lx - ex;
  const oy = ly - ey;

  // grow the scratch patches only when bigger ones are needed
  if (L.tmp.width < ew || L.tmp.height < eh) {
    L.tmp = makeLayer(Math.max(L.tmp.width, ew), Math.max(L.tmp.height, eh), new DOMMatrix());
    L.tmp2 = makeLayer(Math.max(L.tmp2.width, ew), Math.max(L.tmp2.height, eh), new DOMMatrix());
    L.pattern = null;
  }
  const tmpCtx = L.tmp.getContext("2d")!;
  const rimCtx = L.tmp2.getContext("2d")!;
  if (!L.pattern) L.pattern = tmpCtx.createPattern(getMottle(), "repeat");

  // the rim: wet region minus its eroded copy - the outer contour only -
  // plus any drying fronts stranded inside the stain
  tmpCtx.setTransform(1, 0, 0, 1, 0, 0);
  tmpCtx.globalCompositeOperation = "source-over";
  tmpCtx.clearRect(0, 0, ew, eh);
  tmpCtx.drawImage(L.wet, ex, ey, ew, eh, 0, 0, ew, eh);
  tmpCtx.globalCompositeOperation = "destination-out";
  tmpCtx.drawImage(L.core, ex, ey, ew, eh, 0, 0, ew, eh);
  tmpCtx.globalCompositeOperation = "source-over";
  tmpCtx.globalAlpha = 0.5;
  tmpCtx.drawImage(L.tide, ex, ey, ew, eh, 0, 0, ew, eh);
  tmpCtx.globalAlpha = 1;
  // deepen it to pigment-at-the-edge, whatever colors are in the loadout
  tmpCtx.globalCompositeOperation = "source-atop";
  tmpCtx.fillStyle = state.dark ? "rgba(255,255,255,0.55)" : "rgba(60,32,22,0.55)";
  tmpCtx.fillRect(0, 0, ew, eh);
  // bite unevenly into the contour so it pools in some places and nearly
  // vanishes in others. The pattern is pinned to layer coordinates, or it
  // would slide as the patch moves and the same edge would keep changing.
  if (L.pattern) {
    L.pattern.setTransform(new DOMMatrix().translate(-ex, -ey));
    tmpCtx.globalCompositeOperation = "destination-out";
    tmpCtx.globalAlpha = 0.45;
    tmpCtx.fillStyle = L.pattern;
    tmpCtx.fillRect(0, 0, ew, eh);
    tmpCtx.globalAlpha = 1;
  }
  tmpCtx.globalCompositeOperation = "source-over";

  // spread the stranded pigment out into the water instead of leaving it as
  // a drawn contour with two hard sides
  rimCtx.setTransform(1, 0, 0, 1, 0, 0);
  rimCtx.globalCompositeOperation = "source-over";
  rimCtx.clearRect(0, 0, ew, eh);
  rimCtx.filter = `blur(${BLUR_RIM}px)`;
  rimCtx.drawImage(L.tmp, 0, 0);
  rimCtx.filter = "none";

  // the halo of water that carried past the pigment, tinted and feathered
  tmpCtx.clearRect(0, 0, ew, eh);
  tmpCtx.filter = `blur(${BLUR_WASH}px)`;
  tmpCtx.drawImage(L.wet, ex, ey, ew, eh, 0, 0, ew, eh);
  tmpCtx.filter = "none";
  tmpCtx.globalCompositeOperation = "source-in";
  tmpCtx.fillStyle = state.colors[0];
  tmpCtx.fillRect(0, 0, ew, eh);
  tmpCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // the painted stroke, grain and smearing intact
  ctx.clearRect(rx, ry, rw, rh);
  ctx.drawImage(L.paint, rx, ry, rw, rh, rx, ry, rw, rh);

  ctx.globalCompositeOperation = state.dark ? "source-over" : "multiply";
  ctx.globalAlpha = 0.13;
  ctx.drawImage(L.tmp, ox, oy, lw, lh, rx, ry, rw, rh);

  ctx.globalAlpha = 0.6;
  ctx.drawImage(L.tmp2, ox, oy, lw, lh, rx, ry, rw, rh);

  ctx.restore();
}

function scheduleComposite(ctx: CanvasRenderingContext2D, state: WaterState) {
  if (state.raf !== null) return;
  state.raf = requestAnimationFrame(() => {
    state.raf = null;
    composite(ctx, state);
  });
}

export const waterBrush: BrushImpl = {
  init(colors, rand, bg): WaterState {
    const lobes: Lobe[] = [];
    // low frequencies make the big lobes, higher ones the meander; finer
    // than this the reduced mask cannot resolve it, and it aliases into
    // stair-steps instead of reading as meander
    for (const f of [2, 3, 5, 7]) {
      lobes.push({
        freq: f + Math.floor(rand() * 2),
        amp: (0.26 / Math.sqrt(f)) * (0.6 + rand() * 0.9),
        phase: rand() * Math.PI * 2,
      });
    }
    const sumAmp = lobes.reduce((a, l) => a + l.amp, 0);
    return {
      paint: wetBlendBrush.init(colors, rand, bg),
      colors,
      lobes,
      // how far the lobes can throw the outline past the nominal radius; the
      // rebuild has to reach at least this far or a rim that just became
      // interior would be left stranded on the canvas
      reachFactor: 1 + sumAmp * 1.5,
      spin: rand() * Math.PI * 2,
      travelled: 0,
      sinceBloom: 0,
      dark: bg ? isDark(bg) : false,
      layers: null,
      dirty: null,
      raf: null,
    };
  },

  segment(ctx, rawState, rand, prev, cur, color, size) {
    const state = rawState as WaterState;
    if (!state.layers) state.layers = takeLayers(ctx.canvas, ctx.getTransform());
    const L = state.layers;

    // 1. the body of the stroke: ordinary loaded-bristle paint, laid into
    // the offscreen copy so the visible canvas can be rebuilt without the
    // rim accumulating in it
    wetBlendBrush.segment(L.paint.getContext("2d")!, state.paint, rand, prev, cur, color, size);

    // 2. record the wet area the water spread over
    const wetCtx = L.wet.getContext("2d")!;
    const coreCtx = L.core.getContext("2d")!;
    const tideCtx = L.tide.getContext("2d")!;

    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, cur.t - prev.t);
    const speedFactor = Math.min(1, dist / dt / 1.2);
    const pr = ((prev.pr ?? 0.5) + (cur.pr ?? 0.5)) / 2;

    // matches the paint brush's own width, then a little wider - the water
    // always creeps a bit past the pigment it carried
    const paintWidth = size * (1.15 - 0.35 * speedFactor) * (0.6 + pr * 0.8);
    const baseR = paintWidth * 0.42;

    const spacing = Math.max(3, baseR * 0.5);
    const steps = Math.min(40, Math.max(1, Math.round(dist / spacing)));

    const addDab = (x: number, y: number, r: number, rot: number, wobble: number) => {
      blobPath(wetCtx, x, y, r, state.lobes, rot, wobble);
      wetCtx.fillStyle = "#000";
      wetCtx.fill();
      blobPath(coreCtx, x, y, r * CORE, state.lobes, rot, wobble);
      coreCtx.fillStyle = "#000";
      coreCtx.fill();
      const reach = r * state.reachFactor + 2;
      const d = state.dirty;
      if (!d) {
        state.dirty = { minX: x - reach, minY: y - reach, maxX: x + reach, maxY: y + reach };
      } else {
        d.minX = Math.min(d.minX, x - reach);
        d.minY = Math.min(d.minY, y - reach);
        d.maxX = Math.max(d.maxX, x + reach);
        d.maxY = Math.max(d.maxY, y + reach);
      }
    };

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const px = prev.x + dx * t;
      const py = prev.y + dy * t;

      const advance = dist / steps;
      state.travelled += advance;
      state.sinceBloom += advance;

      const rot = state.spin + state.travelled * 0.004;
      const r = baseR * (0.9 + rand() * 0.25);
      addDab(px, py, r, rot, 0.75 + rand() * 0.6);

      // every so often the water creeps out past the brush and dries there,
      // throwing a twisting lobe off the side of the stroke
      if (state.sinceBloom > paintWidth * (1.6 + rand() * 1.8)) {
        state.sinceBloom = 0;
        addDab(
          px + (rand() - 0.5) * paintWidth * 0.32,
          py + (rand() - 0.5) * paintWidth * 0.32,
          r * (1.02 + rand() * 0.22),
          rot + rand() * 2,
          1.0 + rand() * 0.5,
        );

        // an earlier drying front that got overtaken, left behind as a
        // fainter ring nested inside the stain
        if (rand() < 0.5) {
          tideCtx.globalAlpha = 0.55 + rand() * 0.35;
          tideCtx.strokeStyle = "#000";
          tideCtx.lineWidth = Math.max(1, size * 0.03);
          blobPath(tideCtx, px, py, r * (0.45 + rand() * 0.22), state.lobes, rot + rand() * 3, 1.1);
          tideCtx.stroke();
          tideCtx.globalAlpha = 1;
        }
      }
    }

    scheduleComposite(ctx, state);
  },

  flush(ctx, rawState) {
    const state = rawState as WaterState;
    if (state.raf !== null) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    composite(ctx, state);
  },
};
