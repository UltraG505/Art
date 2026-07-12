import type { PaintEngine } from "../engine/paintEngine";
import type { GalleryItem } from "../engine/types";
import { galleryAll, galleryPut, galleryDelete } from "../engine/persist";

const THUMB_MAX = 480;

function makeThumb(engine: PaintEngine): string {
  const full = engine.exportCanvas();
  const scale = Math.min(1, THUMB_MAX / Math.max(full.width, full.height));
  const t = document.createElement("canvas");
  t.width = Math.max(1, Math.round(full.width * scale));
  t.height = Math.max(1, Math.round(full.height * scale));
  t.getContext("2d")!.drawImage(full, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.8);
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface Leaf {
  el: HTMLDivElement;
  turned: boolean;
}

// A tappable sketchbook: pages turn with a 3D flip. The book opens over the
// canvas; closing it returns to painting. Cover first, one page per saved
// piece (oldest first, like a book you fill), and the in-progress canvas as
// the last page.
export function openSketchbook(engine: PaintEngine) {
  if (document.querySelector(".sketchbook")) return;

  const overlay = document.createElement("div");
  overlay.className = "sketchbook";

  const closeBtn = document.createElement("button");
  closeBtn.className = "sketchbook__close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "close sketchbook");
  closeBtn.addEventListener("click", close);

  const hint = document.createElement("div");
  hint.className = "sketchbook__hint";
  hint.textContent = "tap the page edges to turn";

  const book = document.createElement("div");
  book.className = "book";

  const zoneL = document.createElement("div");
  zoneL.className = "book__zone book__zone--left";
  const zoneR = document.createElement("div");
  zoneR.className = "book__zone book__zone--right";

  overlay.append(closeBtn, book, zoneL, zoneR, hint);
  document.body.appendChild(overlay);

  let leaves: Leaf[] = [];

  function close() {
    overlay.remove();
  }

  function applyZ(animating?: HTMLDivElement) {
    const n = leaves.length;
    leaves.forEach((leaf, i) => {
      leaf.el.style.zIndex = leaf.el === animating ? String(n * 2 + 5) : leaf.turned ? String(i + 1) : String(n * 2 - i);
    });
  }

  function turnForward() {
    const leaf = leaves.find((l) => !l.turned);
    // never turn the last page over - there'd be nothing beneath it
    if (!leaf || leaves.indexOf(leaf) === leaves.length - 1) return;
    leaf.turned = true;
    applyZ(leaf.el);
    leaf.el.classList.add("turned");
    setTimeout(() => applyZ(), 650);
  }

  function turnBack() {
    const turned = leaves.filter((l) => l.turned);
    const leaf = turned[turned.length - 1];
    if (!leaf) return;
    leaf.turned = false;
    applyZ(leaf.el);
    leaf.el.classList.remove("turned");
    setTimeout(() => applyZ(), 650);
  }

  zoneR.addEventListener("click", turnForward);
  zoneL.addEventListener("click", turnBack);

  function makeLeaf(front: HTMLDivElement): Leaf {
    const el = document.createElement("div");
    el.className = "page";
    front.classList.add("page__face", "page__face--front");
    const back = document.createElement("div");
    back.className = "page__face page__face--back";
    el.append(front, back);
    book.appendChild(el);
    return { el, turned: false };
  }

  function coverFace(): HTMLDivElement {
    const f = document.createElement("div");
    f.classList.add("page__face--cover");
    const t = document.createElement("div");
    t.className = "cover-title";
    t.textContent = "Abstract Studio";
    const s = document.createElement("div");
    s.className = "cover-sub";
    s.textContent = "sketchbook";
    f.append(t, s);
    return f;
  }

  function itemFace(item: GalleryItem, rebuild: (turnedCount: number) => void, turnedCount: () => number): HTMLDivElement {
    const f = document.createElement("div");
    const img = document.createElement("img");
    img.className = "page-art";
    img.src = item.thumb;
    img.alt = "saved painting";

    const caption = document.createElement("div");
    caption.className = "page-caption";
    caption.textContent = fmtDate(item.updatedAt);

    const row = document.createElement("div");
    row.className = "page-actions";

    const openBtn = document.createElement("button");
    openBtn.className = "page-btn page-btn--primary";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => {
      const ok =
        !engine.hasContent() ||
        confirm("Open this piece? Your current canvas will be replaced (save it to the book first if you want to keep it).");
      if (!ok) return;
      engine.loadDoc(structuredClone(item.doc));
      close();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "page-btn";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Tear this page out of the book? This can't be undone.")) return;
      await galleryDelete(item.id);
      rebuild(Math.max(1, turnedCount() - 1));
    });

    row.append(openBtn, delBtn);
    f.append(img, caption, row);
    return f;
  }

  function currentFace(rebuild: (turnedCount: number) => void, turnedCount: () => number): HTMLDivElement {
    const f = document.createElement("div");
    const img = document.createElement("img");
    img.className = "page-art";
    img.src = makeThumb(engine);
    img.alt = "current canvas";

    const caption = document.createElement("div");
    caption.className = "page-caption";
    caption.textContent = "current canvas";

    const row = document.createElement("div");
    row.className = "page-actions";

    const contBtn = document.createElement("button");
    contBtn.className = "page-btn page-btn--primary";
    contBtn.textContent = "Continue painting";
    contBtn.addEventListener("click", close);

    const saveBtn = document.createElement("button");
    saveBtn.className = "page-btn";
    saveBtn.textContent = "Save to book";
    saveBtn.disabled = !engine.hasContent();
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      await galleryPut({
        id: crypto.randomUUID(),
        thumb: makeThumb(engine),
        doc: structuredClone(engine.getDoc()),
        updatedAt: Date.now(),
      });
      rebuild(turnedCount());
    });

    row.append(contBtn, saveBtn);
    f.append(img, caption, row);
    return f;
  }

  function emptyFace(): HTMLDivElement {
    const f = document.createElement("div");
    const msg = document.createElement("div");
    msg.className = "page-empty";
    msg.textContent = "This book is empty. Paint something, then save it here — every saved piece becomes a page.";
    f.append(msg);
    return f;
  }

  function turnedCount(): number {
    return leaves.filter((l) => l.turned).length;
  }

  async function rebuild(keepTurned: number) {
    book.innerHTML = "";
    leaves = [];
    const items = (await galleryAll()).sort((a, b) => a.updatedAt - b.updatedAt);

    leaves.push(makeLeaf(coverFace()));
    if (items.length === 0) {
      leaves.push(makeLeaf(emptyFace()));
    }
    for (const item of items) {
      leaves.push(makeLeaf(itemFace(item, rebuild, turnedCount)));
    }
    leaves.push(makeLeaf(currentFace(rebuild, turnedCount)));

    const maxTurnable = leaves.length - 1;
    for (let i = 0; i < Math.min(keepTurned, maxTurnable); i++) {
      leaves[i].turned = true;
      leaves[i].el.classList.add("turned", "no-anim");
    }
    applyZ();
    // re-enable the flip animation after the initial state is painted
    requestAnimationFrame(() => {
      for (const l of leaves) l.el.classList.remove("no-anim");
    });
  }

  rebuild(0);
}
