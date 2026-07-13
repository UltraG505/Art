import type { PaintEngine } from "../engine/paintEngine";
import type { GalleryItem, Book } from "../engine/types";
import { galleryByBook, galleryPut, galleryDelete, listBooks, bookPut, bookDelete } from "../engine/persist";
import { canvasToBlob, exportImagePng, exportImageJpg } from "../export/image";

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

// ---------------------------------------------------------------- library

// The home screen: a shelf of sketchbooks. Tap one to flip through it,
// make new ones, or close the library to paint.
export async function openLibrary(engine: PaintEngine) {
  if (document.querySelector(".library")) return;

  const overlay = document.createElement("div");
  overlay.className = "library";

  const closeBtn = document.createElement("button");
  closeBtn.className = "sketchbook__close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "close library");
  closeBtn.addEventListener("click", () => overlay.remove());

  const title = document.createElement("h1");
  title.className = "library__title";
  title.textContent = "Library";

  const shelf = document.createElement("div");
  shelf.className = "library__shelf";

  const paintBtn = document.createElement("button");
  paintBtn.className = "library__paint";
  paintBtn.textContent = "Continue painting";
  paintBtn.addEventListener("click", () => overlay.remove());

  overlay.append(closeBtn, title, shelf, paintBtn);
  document.body.appendChild(overlay);

  async function renderShelf() {
    const books = await listBooks();
    shelf.innerHTML = "";

    for (const book of books) {
      const counts = (await galleryByBook(book.id)).length;

      const cell = document.createElement("div");
      cell.className = "library__book";

      const cover = document.createElement("button");
      cover.className = "library__cover";
      cover.setAttribute("aria-label", `open ${book.title}`);
      const bt = document.createElement("div");
      bt.className = "library__cover-title";
      bt.textContent = book.title;
      const bc = document.createElement("div");
      bc.className = "library__cover-count";
      bc.textContent = counts === 1 ? "1 page" : `${counts} pages`;
      cover.append(bt, bc);
      cover.addEventListener("click", async () => {
        overlay.remove();
        await openSketchbook(engine, book);
      });

      const del = document.createElement("button");
      del.className = "library__del";
      del.textContent = "✕";
      del.setAttribute("aria-label", `delete ${book.title}`);
      del.addEventListener("click", async () => {
        if (!confirm(`Delete "${book.title}" and all ${counts} of its pages? This can't be undone.`)) return;
        await bookDelete(book.id);
        renderShelf();
      });

      cell.append(cover, del);
      shelf.appendChild(cell);
    }

    const add = document.createElement("button");
    add.className = "library__cover library__cover--new";
    add.textContent = "＋ New sketchbook";
    add.setAttribute("aria-label", "new sketchbook");
    add.addEventListener("click", async () => {
      const name = prompt("Name your sketchbook:", `Sketchbook ${(await listBooks()).length + 1}`);
      if (!name) return;
      await bookPut({ id: crypto.randomUUID(), title: name.trim().slice(0, 40), createdAt: Date.now() });
      renderShelf();
    });
    shelf.appendChild(add);
  }

  await renderShelf();
}

// ----------------------------------------------------------------- viewer

// Full-screen look at a saved piece with export options. Pieces are flat
// images (no stroke replay), so opening one is instant.
function openViewer(item: GalleryItem, onDelete: () => void) {
  const overlay = document.createElement("div");
  overlay.className = "viewer";

  const img = document.createElement("img");
  img.className = "viewer__img";
  img.src = item.blob ? URL.createObjectURL(item.blob) : item.thumb;
  img.alt = "saved painting";

  const bar = document.createElement("div");
  bar.className = "viewer__bar";

  const src = () => item.blob ?? item.thumb;
  const stamp = new Date(item.updatedAt).toISOString().slice(0, 10);

  const pngBtn = document.createElement("button");
  pngBtn.className = "page-btn page-btn--primary";
  pngBtn.textContent = "Save PNG";
  pngBtn.addEventListener("click", () => exportImagePng(src(), `painting-${stamp}.png`));

  const jpgBtn = document.createElement("button");
  jpgBtn.className = "page-btn page-btn--primary";
  jpgBtn.textContent = "Save JPG";
  jpgBtn.addEventListener("click", () => exportImageJpg(src(), `painting-${stamp}.jpg`));

  const delBtn = document.createElement("button");
  delBtn.className = "page-btn";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", async () => {
    if (!confirm("Delete this piece? This can't be undone.")) return;
    await galleryDelete(item.id);
    close();
    onDelete();
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "page-btn";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", close);

  bar.append(pngBtn, jpgBtn, delBtn, closeBtn);
  overlay.append(img, bar);
  document.body.appendChild(overlay);

  function close() {
    if (item.blob) URL.revokeObjectURL(img.src);
    overlay.remove();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}

// -------------------------------------------------------------- sketchbook

interface Leaf {
  el: HTMLDivElement;
  turned: boolean;
}

// A tappable sketchbook: pages turn with a 3D flip. Cover first, one page
// per saved piece (tap the art to view/export), and the in-progress canvas
// as the last page.
export async function openSketchbook(engine: PaintEngine, book: Book) {
  if (document.querySelector(".sketchbook")) return;

  const overlay = document.createElement("div");
  overlay.className = "sketchbook";

  const backBtn = document.createElement("button");
  backBtn.className = "sketchbook__back";
  backBtn.textContent = "‹ Library";
  backBtn.setAttribute("aria-label", "back to library");
  backBtn.addEventListener("click", () => {
    overlay.remove();
    openLibrary(engine);
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "sketchbook__close";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "close sketchbook");
  closeBtn.addEventListener("click", close);

  const hint = document.createElement("div");
  hint.className = "sketchbook__hint";
  hint.textContent = "tap the page edges to turn · tap a painting to view & export";

  const bookEl = document.createElement("div");
  bookEl.className = "book";

  const zoneL = document.createElement("div");
  zoneL.className = "book__zone book__zone--left";
  const zoneR = document.createElement("div");
  zoneR.className = "book__zone book__zone--right";

  overlay.append(backBtn, closeBtn, bookEl, zoneL, zoneR, hint);
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
    bookEl.appendChild(el);
    return { el, turned: false };
  }

  function coverFace(): HTMLDivElement {
    const f = document.createElement("div");
    f.classList.add("page__face--cover");
    const t = document.createElement("div");
    t.className = "cover-title";
    t.textContent = book.title;
    const s = document.createElement("div");
    s.className = "cover-sub";
    s.textContent = "sketchbook";
    f.append(t, s);
    return f;
  }

  function itemFace(item: GalleryItem): HTMLDivElement {
    const f = document.createElement("div");
    const img = document.createElement("img");
    img.className = "page-art page-art--tappable";
    img.src = item.thumb;
    img.alt = "saved painting - tap to view";
    img.addEventListener("click", () => openViewer(item, () => rebuild(turnedCount())));

    const caption = document.createElement("div");
    caption.className = "page-caption";
    caption.textContent = fmtDate(item.updatedAt);

    f.append(img, caption);
    return f;
  }

  function currentFace(): HTMLDivElement {
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
      const blob = await canvasToBlob(engine.exportCanvas());
      await galleryPut({
        id: crypto.randomUUID(),
        bookId: book.id,
        thumb: makeThumb(engine),
        blob,
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
    bookEl.innerHTML = "";
    leaves = [];
    const items = await galleryByBook(book.id);

    leaves.push(makeLeaf(coverFace()));
    if (items.length === 0) {
      leaves.push(makeLeaf(emptyFace()));
    }
    for (const item of items) {
      leaves.push(makeLeaf(itemFace(item)));
    }
    leaves.push(makeLeaf(currentFace()));

    const maxTurnable = leaves.length - 1;
    for (let i = 0; i < Math.min(keepTurned, maxTurnable); i++) {
      leaves[i].turned = true;
      leaves[i].el.classList.add("turned", "no-anim");
    }
    applyZ();
    requestAnimationFrame(() => {
      for (const l of leaves) l.el.classList.remove("no-anim");
    });
  }

  await rebuild(0);
}
