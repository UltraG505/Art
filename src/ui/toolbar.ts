import { PALETTE } from "./palette";
import type { PaintEngine } from "../engine/paintEngine";
import type { BrushId } from "../engine/types";
import { exportCanvasPng } from "../export/image";
import { openNewCanvasDialog } from "./newCanvasDialog";
import { openLibrary } from "./sketchbook";
import { openColorPicker } from "./colorPicker";

const BRUSH_OPTIONS: { id: BrushId; label: string; title: string }[] = [
  { id: "wetBlend", label: "Paint", title: "wet paint - blends with color underneath" },
  { id: "flow", label: "Flow", title: "curvy streaked strokes with bristle ridges" },
  { id: "chalk", label: "Chalk", title: "dry pastel - grainy scribble marks" },
  { id: "glow", label: "Glow", title: "light trail - best on a black canvas" },
  { id: "ink", label: "Ink", title: "thin pen line for details" },
  { id: "smudge", label: "Smudge", title: "no color - drags the paint already there" },
];

export function buildToolbar(engine: PaintEngine): HTMLDivElement {
  const bar = document.createElement("div");
  bar.className = "toolbar";

  const rowTools = document.createElement("div");
  rowTools.className = "toolbar__row";
  const rowColors = document.createElement("div");
  rowColors.className = "toolbar__row";

  // ---- row 1: brushes | actions ----

  const brushWrap = document.createElement("div");
  brushWrap.className = "toolbar__brushes";
  const brushButtons: HTMLButtonElement[] = [];
  for (const opt of BRUSH_OPTIONS) {
    const b = document.createElement("button");
    b.className = "brush-btn";
    b.textContent = opt.label;
    b.title = opt.title;
    b.setAttribute("aria-label", `brush ${opt.label}`);
    b.addEventListener("click", () => {
      engine.brush = opt.id;
      for (const other of brushButtons) other.classList.toggle("is-active", other === b);
    });
    brushButtons.push(b);
    brushWrap.appendChild(b);
  }
  brushButtons[0].classList.add("is-active");

  const actions = document.createElement("div");
  actions.className = "toolbar__actions";

  const undoBtn = document.createElement("button");
  undoBtn.className = "icon-btn";
  undoBtn.textContent = "↶";
  undoBtn.setAttribute("aria-label", "undo");
  undoBtn.addEventListener("click", () => engine.undo());

  const redoBtn = document.createElement("button");
  redoBtn.className = "icon-btn";
  redoBtn.textContent = "↷";
  redoBtn.setAttribute("aria-label", "redo");
  redoBtn.addEventListener("click", () => engine.redo());

  const clearBtn = document.createElement("button");
  clearBtn.className = "icon-btn";
  clearBtn.textContent = "✕";
  clearBtn.setAttribute("aria-label", "clear canvas");
  clearBtn.addEventListener("click", () => {
    if (confirm("Clear the whole canvas? This can't be undone.")) {
      engine.clear();
    }
  });

  const newCanvasBtn = document.createElement("button");
  newCanvasBtn.className = "icon-btn";
  newCanvasBtn.textContent = "▦";
  newCanvasBtn.setAttribute("aria-label", "new canvas");
  newCanvasBtn.addEventListener("click", () => {
    const proceed = !engine.canUndo() || confirm("Start a new canvas? This will discard your current painting.");
    if (!proceed) return;
    openNewCanvasDialog((w, h, bg) => engine.newCanvas(w, h, bg));
  });

  const galleryBtn = document.createElement("button");
  galleryBtn.className = "icon-btn";
  galleryBtn.textContent = "▤";
  galleryBtn.setAttribute("aria-label", "gallery");
  galleryBtn.addEventListener("click", () => openLibrary(engine));

  const exportBtn = document.createElement("button");
  exportBtn.className = "icon-btn";
  exportBtn.textContent = "⇧";
  exportBtn.setAttribute("aria-label", "export painting");
  exportBtn.addEventListener("click", () => {
    exportCanvasPng(engine.exportCanvas());
  });

  actions.append(newCanvasBtn, galleryBtn, undoBtn, redoBtn, clearBtn, exportBtn);
  rowTools.append(brushWrap, actions);

  // ---- row 2: color slots | palette | custom | size ----

  // color loadout: up to three slots painted in one stroke by multi-color
  // brushes. Tap a slot to select it, tap a palette color to fill it; the
  // small x on a filled extra slot removes it.
  const slots: (string | null)[] = [engine.colors[0] ?? PALETTE[0], null, null];
  let activeSlot = 0;

  const slotWrap = document.createElement("div");
  slotWrap.className = "toolbar__slots";
  const slotButtons: HTMLButtonElement[] = [];
  const slotClears: HTMLButtonElement[] = [];

  function syncEngine() {
    engine.colors = slots.filter((c): c is string => c !== null);
  }

  function renderSlots() {
    slotButtons.forEach((b, i) => {
      const c = slots[i];
      b.classList.toggle("is-empty", c === null);
      b.classList.toggle("is-active", i === activeSlot);
      b.style.background = c ?? "transparent";
      b.textContent = c === null ? "+" : "";
      if (slotClears[i]) slotClears[i].style.display = c !== null && i > 0 ? "flex" : "none";
    });
  }

  for (let i = 0; i < 3; i++) {
    const holder = document.createElement("span");
    holder.className = "color-slot-holder";

    const b = document.createElement("button");
    b.className = "color-slot";
    b.setAttribute("aria-label", `color slot ${i + 1}`);
    b.addEventListener("click", () => {
      if (slots[i] === null) slots[i] = slots[0];
      activeSlot = i;
      syncEngine();
      renderSlots();
      refreshSwatchRing();
    });
    slotButtons.push(b);
    holder.appendChild(b);

    if (i > 0) {
      const x = document.createElement("button");
      x.className = "color-slot-clear";
      x.textContent = "✕";
      x.setAttribute("aria-label", `remove color slot ${i + 1}`);
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        slots[i] = null;
        if (activeSlot === i) activeSlot = 0;
        syncEngine();
        renderSlots();
        refreshSwatchRing();
      });
      slotClears[i] = x;
      holder.appendChild(x);
    }
    slotWrap.appendChild(holder);
  }

  const divider1 = document.createElement("div");
  divider1.className = "toolbar__divider";

  const swatchWrap = document.createElement("div");
  swatchWrap.className = "toolbar__swatches";

  const swatchButtons: HTMLButtonElement[] = [];
  function refreshSwatchRing() {
    const activeColor = slots[activeSlot];
    for (const b of swatchButtons) {
      b.classList.toggle("is-active", b.dataset.color === activeColor);
    }
    customSwatch.classList.toggle("is-active", activeColor !== null && !PALETTE.includes(activeColor));
    if (activeColor && !PALETTE.includes(activeColor)) customSwatch.style.background = activeColor;
  }

  function setActiveColor(color: string) {
    slots[activeSlot] = color;
    syncEngine();
    renderSlots();
    refreshSwatchRing();
  }

  for (const color of PALETTE) {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = color;
    b.dataset.color = color;
    b.setAttribute("aria-label", `color ${color}`);
    b.addEventListener("click", () => setActiveColor(color));
    swatchWrap.appendChild(b);
    swatchButtons.push(b);
  }

  // custom color: opens our own HSV picker (the native <input type=color>
  // fails to open on some Android builds)
  const customSwatch = document.createElement("button");
  customSwatch.className = "swatch swatch--custom";
  customSwatch.setAttribute("aria-label", "custom color");
  customSwatch.addEventListener("click", () => {
    openColorPicker(slots[activeSlot] ?? slots[0]!, (hex) => setActiveColor(hex));
  });
  swatchWrap.appendChild(customSwatch);

  syncEngine();
  renderSlots();
  refreshSwatchRing();

  const divider2 = document.createElement("div");
  divider2.className = "toolbar__divider";

  const sizeWrap = document.createElement("div");
  sizeWrap.className = "toolbar__size";
  const dotSmall = document.createElement("span");
  dotSmall.className = "size-dot";
  dotSmall.style.width = "6px";
  dotSmall.style.height = "6px";
  const sizeSlider = document.createElement("input");
  sizeSlider.type = "range";
  sizeSlider.min = "8";
  sizeSlider.max = "110";
  sizeSlider.value = String(engine.size);
  sizeSlider.addEventListener("input", () => {
    engine.size = Number(sizeSlider.value);
  });
  const dotBig = document.createElement("span");
  dotBig.className = "size-dot";
  dotBig.style.width = "16px";
  dotBig.style.height = "16px";
  sizeWrap.append(dotSmall, sizeSlider, dotBig);

  rowColors.append(slotWrap, divider1, swatchWrap, divider2, sizeWrap);

  function refreshHistoryButtons() {
    undoBtn.disabled = !engine.canUndo();
    redoBtn.disabled = !engine.canRedo();
  }
  engine.onHistory(refreshHistoryButtons);
  refreshHistoryButtons();

  bar.append(rowTools, rowColors);
  return bar;
}
