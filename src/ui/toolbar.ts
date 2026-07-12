import { PALETTE } from "./palette";
import type { PaintEngine } from "../engine/paintEngine";
import { exportPng } from "../export/png";

export function buildToolbar(engine: PaintEngine): HTMLDivElement {
  const bar = document.createElement("div");
  bar.className = "toolbar";

  const swatchWrap = document.createElement("div");
  swatchWrap.className = "toolbar__swatches";

  const swatchButtons: HTMLButtonElement[] = [];
  function setActiveColor(color: string) {
    engine.color = color;
    for (const b of swatchButtons) {
      b.classList.toggle("is-active", b.dataset.color === color);
    }
    customSwatch.classList.toggle("is-active", !PALETTE.includes(color));
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

  const customSwatch = document.createElement("label");
  customSwatch.className = "swatch swatch--custom";
  customSwatch.setAttribute("aria-label", "custom color");
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = engine.color;
  colorInput.addEventListener("input", () => setActiveColor(colorInput.value));
  customSwatch.appendChild(colorInput);
  swatchWrap.appendChild(customSwatch);

  setActiveColor(engine.color);

  const divider1 = document.createElement("div");
  divider1.className = "toolbar__divider";

  const sizeWrap = document.createElement("div");
  sizeWrap.className = "toolbar__size";
  const dotSmall = document.createElement("span");
  dotSmall.className = "size-dot";
  dotSmall.style.width = "6px";
  dotSmall.style.height = "6px";
  const sizeSlider = document.createElement("input");
  sizeSlider.type = "range";
  sizeSlider.min = "8";
  sizeSlider.max = "80";
  sizeSlider.value = String(engine.size);
  sizeSlider.addEventListener("input", () => {
    engine.size = Number(sizeSlider.value);
  });
  const dotBig = document.createElement("span");
  dotBig.className = "size-dot";
  dotBig.style.width = "16px";
  dotBig.style.height = "16px";
  sizeWrap.append(dotSmall, sizeSlider, dotBig);

  const divider2 = document.createElement("div");
  divider2.className = "toolbar__divider";

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

  const exportBtn = document.createElement("button");
  exportBtn.className = "icon-btn";
  exportBtn.textContent = "⇧";
  exportBtn.setAttribute("aria-label", "export painting");
  exportBtn.addEventListener("click", () => {
    exportPng(engine.exportCanvas());
  });

  actions.append(undoBtn, redoBtn, clearBtn, exportBtn);

  function refreshHistoryButtons() {
    undoBtn.disabled = !engine.canUndo();
    redoBtn.disabled = !engine.canRedo();
  }
  engine.onHistoryChange = refreshHistoryButtons;
  refreshHistoryButtons();

  bar.append(swatchWrap, divider1, sizeWrap, divider2, actions);
  return bar;
}
