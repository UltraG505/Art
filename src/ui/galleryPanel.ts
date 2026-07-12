import type { PaintEngine } from "../engine/paintEngine";
import type { GalleryItem } from "../engine/types";
import { galleryAll, galleryPut, galleryDelete } from "../engine/persist";

const THUMB_MAX = 320;

function makeThumb(engine: PaintEngine): string {
  const full = engine.exportCanvas();
  const scale = Math.min(1, THUMB_MAX / Math.max(full.width, full.height));
  const t = document.createElement("canvas");
  t.width = Math.max(1, Math.round(full.width * scale));
  t.height = Math.max(1, Math.round(full.height * scale));
  t.getContext("2d")!.drawImage(full, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.75);
}

export function openGalleryPanel(engine: PaintEngine) {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";

  const dialog = document.createElement("div");
  dialog.className = "dialog dialog--gallery";

  const title = document.createElement("h2");
  title.textContent = "Gallery";
  dialog.appendChild(title);

  const saveBtn = document.createElement("button");
  saveBtn.className = "gallery-save-btn";
  saveBtn.textContent = "＋ Save current painting";
  saveBtn.disabled = !engine.hasContent();
  dialog.appendChild(saveBtn);

  const grid = document.createElement("div");
  grid.className = "gallery-grid";
  dialog.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "dialog__actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-secondary";
  closeBtn.textContent = "Close";
  actions.appendChild(closeBtn);
  dialog.appendChild(actions);

  function close() {
    overlay.remove();
  }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  async function renderGrid() {
    const items = await galleryAll();
    grid.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "gallery-empty";
      empty.textContent = "No saved pieces yet. Paint something, then save it here.";
      grid.appendChild(empty);
      return;
    }
    for (const item of items) {
      grid.appendChild(renderItem(item));
    }
  }

  function renderItem(item: GalleryItem): HTMLDivElement {
    const cell = document.createElement("div");
    cell.className = "gallery-item";

    const img = document.createElement("img");
    img.src = item.thumb;
    img.alt = "saved painting";
    img.addEventListener("click", () => {
      const ok =
        !engine.hasContent() ||
        confirm("Open this piece? Your current canvas will be replaced (save it first if you want to keep it).");
      if (!ok) return;
      engine.loadDoc(structuredClone(item.doc));
      close();
    });

    const del = document.createElement("button");
    del.className = "gallery-item__del";
    del.textContent = "✕";
    del.setAttribute("aria-label", "delete saved painting");
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this saved piece? This can't be undone.")) return;
      await galleryDelete(item.id);
      renderGrid();
    });

    cell.append(img, del);
    return cell;
  }

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    await galleryPut({
      id: crypto.randomUUID(),
      thumb: makeThumb(engine),
      doc: structuredClone(engine.getDoc()),
      updatedAt: Date.now(),
    });
    saveBtn.textContent = "✓ Saved";
    setTimeout(() => {
      saveBtn.textContent = "＋ Save current painting";
      saveBtn.disabled = !engine.hasContent();
    }, 1200);
    renderGrid();
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  renderGrid();
}
