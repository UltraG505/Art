interface Preset {
  label: string;
  w: number | null;
  h: number | null;
}

const PRESETS: Preset[] = [
  { label: "Fit Screen", w: null, h: null },
  { label: "Square", w: 2000, h: 2000 },
  { label: "Portrait", w: 1600, h: 2000 },
  { label: "Story", w: 1080, h: 1920 },
];

const MIN_DIM = 200;
const MAX_DIM = 3000;

export function openNewCanvasDialog(onChoose: (w?: number, h?: number) => void) {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";

  const dialog = document.createElement("div");
  dialog.className = "dialog";

  const title = document.createElement("h2");
  title.textContent = "New Canvas";
  dialog.appendChild(title);

  const presetGrid = document.createElement("div");
  presetGrid.className = "dialog__presets";

  function close() {
    overlay.remove();
  }

  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.className = "preset-btn";

    const swatch = document.createElement("div");
    swatch.className = "preset-btn__swatch";
    const aspect = preset.w && preset.h ? preset.w / preset.h : 9 / 16;
    const swatchH = 40;
    swatch.style.height = `${swatchH}px`;
    swatch.style.width = `${Math.round(swatchH * Math.min(aspect, 1.6))}px`;
    swatch.style.borderRadius = "3px";

    const label = document.createElement("div");
    label.textContent = preset.label;

    const dims = document.createElement("div");
    dims.className = "preset-btn__dims";
    dims.textContent = preset.w && preset.h ? `${preset.w}×${preset.h}` : "fills your screen";

    btn.append(swatch, label, dims);
    btn.addEventListener("click", () => {
      onChoose(preset.w ?? undefined, preset.h ?? undefined);
      close();
    });
    presetGrid.appendChild(btn);
  }
  dialog.appendChild(presetGrid);

  const custom = document.createElement("div");
  custom.className = "dialog__custom";

  const row = document.createElement("div");
  row.className = "dialog__custom-row";
  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.placeholder = "Width";
  widthInput.min = String(MIN_DIM);
  widthInput.max = String(MAX_DIM);
  widthInput.value = "1500";
  const xSpan = document.createElement("span");
  xSpan.textContent = "×";
  const heightInput = document.createElement("input");
  heightInput.type = "number";
  heightInput.placeholder = "Height";
  heightInput.min = String(MIN_DIM);
  heightInput.max = String(MAX_DIM);
  heightInput.value = "1500";
  row.append(widthInput, xSpan, heightInput);
  custom.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "dialog__actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", close);

  const createBtn = document.createElement("button");
  createBtn.className = "btn-primary";
  createBtn.textContent = "Use Custom Size";
  createBtn.addEventListener("click", () => {
    const w = Math.min(MAX_DIM, Math.max(MIN_DIM, Math.round(Number(widthInput.value) || 0)));
    const h = Math.min(MAX_DIM, Math.max(MIN_DIM, Math.round(Number(heightInput.value) || 0)));
    onChoose(w, h);
    close();
  });

  actions.append(cancelBtn, createBtn);
  custom.appendChild(actions);
  dialog.appendChild(custom);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);
}
