import type { BrushImpl } from "./brushes";
import { hexToRgb, darken } from "./color";
import { mulberry32 } from "./random";

// Watercolor.
//
// What makes a water stain read as a water stain is the drying edge: water
// carries pigment outward, evaporates at the perimeter and strands it there,
// leaving a pale even interior ringed by ONE darker meandering contour.
//
// So this brush does not paint dabs straight onto the canvas - stamping
// rimmed dabs leaves every dab's outline crossing the interior and the whole
// thing turns hairy. Instead each stroke accumulates its wet region in an
// offscreen layer at full opacity (so overlaps stay flat instead of building
// up), plus a second copy of the same region shrunk slightly. The difference
// between the two is exactly the outer boundary of the whole region, which
// is where the rim goes. The canvas is then recomposited from a snapshot
// taken at stroke start, so wash laid down later dissolves the rim it
// covers, the way fresh water reactivates a drying edge.
//
// Recompositing is confined to the area the newest dabs touched (padded by
// one dab radius, which bounds where an old rim can have just become
// interior), so the cost per input event stays local rather than full-canvas.

interface Lobe {
  freq: number;
  amp: number;
  phase: number;
}

interface Layers {
  wet: HTMLCanvasElement; // colored dabs at full alpha; its alpha is the region
  core: HTMLCanvasElement; // same dabs, shrunk - eroded region
  base: HTMLCanvasElement; // canvas content before this stroke
  // scratch for building the rim. Only ever holds the patch being
  // recomposited, so it stays small even on a 2000px canvas - a full-size
  // scratch layer here was a third of the per-stroke allocation and made
  // every composite touch far more memory than it needed to.
  tmp: HTMLCanvasElement;
  pattern: CanvasPattern | null;
  // The region layers are kept at reduced resolution. A wash edge is soft by
  // nature, so full canvas resolution buys nothing visible, while on a
  // 2000px canvas the dabs scale up with it and every composite would push
  // millions of pixels per input event - that was a 600ms stall mid-stroke.
  scale: number;
}

const LAYER_MAX = 1400;

interface Dirty {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface WaterState {
  colors: string[];
  lobes: Lobe[];
  reachFactor: number;
  spin: number;
  travelled: number;
  sinceBloom: number;
  dark: boolean;
  layers: Layers | null;
  // Dabs land in the offscreen layers immediately, but the visible
  // recomposite is coalesced into one pass per animation frame. Touch panels
  // deliver input far faster than the display refreshes, and compositing per
  // event meant redoing the same patch several times before anything was
  // shown - the single biggest cost in the brush.
  dirty: Dirty | null;
  raf: number | null;
}

const POINTS = 36;
const CORE = 0.91; // eroded radius as a fraction of the wet radius

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
// buffers every time the finger came down - a visible hitch at the start of
// each stroke, and steady GC pressure through a session.
let pool: (Layers & { w: number; h: number }) | null = null;

function takeLayers(canvas: HTMLCanvasElement, t: DOMMatrix): Layers {
  const ls = Math.min(1, LAYER_MAX / Math.max(canvas.width, canvas.height));
  const lw = Math.max(1, Math.round(canvas.width * ls));
  const lh = Math.max(1, Math.round(canvas.height * ls));
  // dabs are addressed in logical units, so the layer transform is the
  // canvas transform with the downscale folded in
  const lt = new DOMMatrix([t.a * ls, 0, 0, t.d * ls, 0, 0]);

  if (!pool || pool.w !== canvas.width || pool.h !== canvas.height) {
    pool = {
      w: canvas.width,
      h: canvas.height,
      wet: makeLayer(lw, lh, lt),
      core: makeLayer(lw, lh, lt),
      base: makeLayer(canvas.width, canvas.height, new DOMMatrix()),
      tmp: makeLayer(64, 64, new DOMMatrix()),
      pattern: null,
      scale: ls,
    };
  } else {
    for (const layer of [pool.wet, pool.core]) {
      const c = layer.getContext("2d")!;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, layer.width, layer.height);
      c.setTransform(lt);
    }
    pool.scale = ls;
  }

  const baseCtx = pool.base.getContext("2d")!;
  baseCtx.setTransform(1, 0, 0, 1, 0, 0);
  baseCtx.clearRect(0, 0, pool.base.width, pool.base.height);
  baseCtx.drawImage(canvas, 0, 0);
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

// Repaints the dirty patch from the pre-stroke snapshot: untouched canvas,
// then the flat wash, then the rim taken from the region's outer boundary.
// Rebuilding from the snapshot each time is what lets later wash dissolve
// the rim it now covers, instead of leaving outlines stranded mid-stain.
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

  // the same patch expressed in the reduced-resolution layers
  const ls = L.scale;
  const lx = Math.max(0, Math.floor(rx * ls));
  const ly = Math.max(0, Math.floor(ry * ls));
  const lw = Math.max(1, Math.min(L.wet.width - lx, Math.ceil(rw * ls)));
  const lh = Math.max(1, Math.min(L.wet.height - ly, Math.ceil(rh * ls)));

  // grow the scratch patch only when a bigger one is needed
  if (L.tmp.width < lw || L.tmp.height < lh) {
    L.tmp = makeLayer(Math.max(L.tmp.width, lw), Math.max(L.tmp.height, lh), new DOMMatrix());
    L.pattern = null;
  }
  const tmpCtx = L.tmp.getContext("2d")!;
  if (!L.pattern) L.pattern = tmpCtx.createPattern(getMottle(), "repeat");

  // the rim: wet region minus its eroded copy - the outer contour only,
  // built in the patch's own coordinates
  tmpCtx.setTransform(1, 0, 0, 1, 0, 0);
  tmpCtx.globalCompositeOperation = "source-over";
  tmpCtx.clearRect(0, 0, lw, lh);
  tmpCtx.drawImage(L.wet, lx, ly, lw, lh, 0, 0, lw, lh);
  tmpCtx.globalCompositeOperation = "destination-out";
  tmpCtx.drawImage(L.core, lx, ly, lw, lh, 0, 0, lw, lh);
  // deepen it to pigment-at-the-edge, whatever colors are in the loadout
  tmpCtx.globalCompositeOperation = "source-atop";
  tmpCtx.fillStyle = state.dark ? "rgba(255,255,255,0.45)" : "rgba(45,22,16,0.5)";
  tmpCtx.fillRect(0, 0, lw, lh);
  // bite unevenly into the contour so it pools in some places and nearly
  // vanishes in others. The pattern is pinned to layer coordinates, or it
  // would slide as the patch moves and the same edge would keep changing.
  if (L.pattern) {
    L.pattern.setTransform(new DOMMatrix().translate(-lx, -ly));
    tmpCtx.globalCompositeOperation = "destination-out";
    tmpCtx.globalAlpha = 0.45;
    tmpCtx.fillStyle = L.pattern;
    tmpCtx.fillRect(0, 0, lw, lh);
    tmpCtx.globalAlpha = 1;
  }
  tmpCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  ctx.clearRect(rx, ry, rw, rh);
  ctx.drawImage(L.base, rx, ry, rw, rh, rx, ry, rw, rh);

  // the wash: one flat pass over the whole wet region, so overlapping dabs
  // read as a single even stain rather than mottled buildup
  ctx.globalCompositeOperation = state.dark ? "source-over" : "multiply";
  ctx.globalAlpha = 0.2;
  ctx.drawImage(L.wet, lx, ly, lw, lh, rx, ry, rw, rh);

  ctx.globalAlpha = 0.85;
  ctx.drawImage(L.tmp, 0, 0, lw, lh, rx, ry, rw, rh);

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
    // low frequencies make the big lobes, high ones the fine meander;
    // amplitudes fall off with frequency so the outline never pinches shut
    for (const f of [2, 3, 5, 7, 11]) {
      lobes.push({
        freq: f + Math.floor(rand() * 2),
        amp: (0.22 / Math.sqrt(f)) * (0.6 + rand() * 0.9),
        phase: rand() * Math.PI * 2,
      });
    }
    // how far the lobes can push the outline past the nominal radius; the
    // recomposite has to reach at least this far or a rim that just became
    // interior would be left stranded on the canvas
    const sumAmp = lobes.reduce((a, l) => a + l.amp, 0);
    return {
      colors,
      lobes,
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

  segment(ctx, rawState, rand, prev, cur, _color, size) {
    const state = rawState as WaterState;
    const canvas = ctx.canvas;

    if (!state.layers) {
      state.layers = takeLayers(canvas, ctx.getTransform());
    }
    const L = state.layers;
    const wetCtx = L.wet.getContext("2d")!;
    const coreCtx = L.core.getContext("2d")!;

    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, cur.t - prev.t);
    const speedFactor = Math.min(1, dist / dt / 1.4);
    const pr = ((prev.pr ?? 0.5) + (cur.pr ?? 0.5)) / 2;

    // dragging slowly floods more water onto the paper; a quick flick leaves
    // a thin, starved trail
    const wet = (1.1 - 0.4 * speedFactor) * (0.65 + pr * 0.7);
    const spacing = Math.max(3, size * 0.26);
    const steps = Math.min(40, Math.max(1, Math.round(dist / spacing)));

    const addDab = (x: number, y: number, r: number, rot: number, wobble: number, color: string) => {
      wetCtx.globalAlpha = 1;
      wetCtx.fillStyle = color;
      blobPath(wetCtx, x, y, r, state.lobes, rot, wobble);
      wetCtx.fill();
      blobPath(coreCtx, x, y, r * CORE, state.lobes, rot, wobble);
      coreCtx.fillStyle = "#000";
      coreCtx.fill();
      // pad by how far the lobes can throw the outline, which is also how
      // far a previously drawn rim can have just been swallowed
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
      const color = state.colors[Math.floor(rand() * state.colors.length)];

      const advance = dist / steps;
      state.travelled += advance;
      state.sinceBloom += advance;

      const rot = state.spin + state.travelled * 0.004;
      const r = size * 0.5 * wet * (0.85 + rand() * 0.3);
      addDab(px, py, r, rot, 0.75 + rand() * 0.6, color);

      // every so often the water creeps out past the brush and dries there,
      // throwing the twisting lobe off the side of the stroke
      if (state.sinceBloom > size * (1.0 + rand() * 1.3)) {
        state.sinceBloom = 0;
        addDab(
          px + (rand() - 0.5) * size * 0.9,
          py + (rand() - 0.5) * size * 0.9,
          r * (1.15 + rand() * 0.7),
          rot + rand() * 2,
          1.0 + rand() * 0.5,
          color,
        );

        // an earlier drying front that got overtaken, left behind as a
        // fainter ring nested inside the stain. Drawn into the wet layer, so
        // it is tinted by the wash and can never escape the region's edge.
        if (rand() < 0.55) {
          wetCtx.globalAlpha = 0.5 + rand() * 0.35;
          wetCtx.strokeStyle = darken(color, 0.45);
          wetCtx.lineWidth = Math.max(1, size * 0.035);
          blobPath(wetCtx, px, py, r * (0.5 + rand() * 0.22), state.lobes, rot + rand() * 3, 1.1);
          wetCtx.stroke();
          wetCtx.globalAlpha = 1;
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
