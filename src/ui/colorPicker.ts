import { hexToRgb, rgbToHex, hsvToRgb, rgbToHsv, isValidHex, normalizeHex } from "../engine/color";

// Canvas-based HSV picker: saturation/brightness pad + hue slider + hex
// field. Replaces <input type=color>, which opens unreliably inside labels
// on some Android Chrome builds.
export function openColorPicker(initial: string, onPick: (hex: string) => void) {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";

  const dialog = document.createElement("div");
  dialog.className = "dialog dialog--picker";

  const title = document.createElement("h2");
  title.textContent = "Pick a color";
  dialog.appendChild(title);

  let [h, s, v] = rgbToHsv(...hexToRgb(isValidHex(initial) ? initial : "#7a1f2b"));

  // saturation/value pad
  const pad = document.createElement("canvas");
  pad.className = "picker-pad";
  pad.width = 280;
  pad.height = 180;
  const padCtx = pad.getContext("2d")!;

  const padCursor = document.createElement("div");
  padCursor.className = "picker-pad-cursor";
  const padWrap = document.createElement("div");
  padWrap.className = "picker-pad-wrap";
  padWrap.append(pad, padCursor);
  dialog.appendChild(padWrap);

  // hue slider
  const hue = document.createElement("input");
  hue.type = "range";
  hue.min = "0";
  hue.max = "360";
  hue.step = "1";
  hue.className = "picker-hue";
  dialog.appendChild(hue);

  // preview + hex
  const row = document.createElement("div");
  row.className = "picker-row";
  const preview = document.createElement("div");
  preview.className = "picker-preview";
  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "picker-hex";
  hexInput.autocomplete = "off";
  hexInput.spellcheck = false;
  hexInput.inputMode = "text";
  row.append(preview, hexInput);
  dialog.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "dialog__actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-secondary";
  cancelBtn.textContent = "Cancel";
  const okBtn = document.createElement("button");
  okBtn.className = "btn-primary";
  okBtn.textContent = "Use color";
  actions.append(cancelBtn, okBtn);
  dialog.appendChild(actions);

  function currentHex(): string {
    return rgbToHex(...hsvToRgb(h, s, v));
  }

  function renderPad() {
    const [hr, hg, hb] = hsvToRgb(h, 1, 1);
    const gx = padCtx.createLinearGradient(0, 0, pad.width, 0);
    gx.addColorStop(0, "#ffffff");
    gx.addColorStop(1, `rgb(${hr},${hg},${hb})`);
    padCtx.fillStyle = gx;
    padCtx.fillRect(0, 0, pad.width, pad.height);
    const gy = padCtx.createLinearGradient(0, 0, 0, pad.height);
    gy.addColorStop(0, "rgba(0,0,0,0)");
    gy.addColorStop(1, "#000000");
    padCtx.fillStyle = gy;
    padCtx.fillRect(0, 0, pad.width, pad.height);
  }

  function sync(fromHexField = false) {
    if (!fromHexField) hexInput.value = currentHex();
    preview.style.background = currentHex();
    hue.value = String(Math.round(h));
    const rect = { w: pad.clientWidth || pad.width, h: pad.clientHeight || pad.height };
    padCursor.style.left = `${s * rect.w}px`;
    padCursor.style.top = `${(1 - v) * rect.h}px`;
    renderPad();
  }

  function padPick(e: PointerEvent) {
    const rect = pad.getBoundingClientRect();
    s = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    v = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
    sync();
  }

  let padDown = false;
  pad.addEventListener("pointerdown", (e) => {
    padDown = true;
    pad.setPointerCapture(e.pointerId);
    padPick(e);
  });
  pad.addEventListener("pointermove", (e) => {
    if (padDown) padPick(e);
  });
  pad.addEventListener("pointerup", () => (padDown = false));
  pad.style.touchAction = "none";

  hue.addEventListener("input", () => {
    h = Number(hue.value);
    sync();
  });

  hexInput.addEventListener("input", () => {
    if (isValidHex(hexInput.value)) {
      const hex = normalizeHex(hexInput.value);
      [h, s, v] = rgbToHsv(...hexToRgb(hex));
      sync(true);
    }
  });

  function close() {
    overlay.remove();
  }
  cancelBtn.addEventListener("click", close);
  okBtn.addEventListener("click", () => {
    onPick(currentHex());
    close();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  sync();
}
