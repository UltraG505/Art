import type { PaintingDoc, GalleryItem, Book } from "./types";

const DB_NAME = "abstract-studio";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    // if an old tab/PWA process still holds the previous schema version open,
    // the upgrade blocks INDEFINITELY and every storage call at boot hangs
    // with it - never let that freeze the app; fail after a timeout and let
    // painting work without persistence (a retry happens on the next call)
    const timeout = setTimeout(() => {
      dbPromise = null;
      reject(new Error("IndexedDB open timed out (old app version still open?)"));
    }, 4000);

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("gallery")) db.createObjectStore("gallery", { keyPath: "id" });
      if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
    };
    req.onsuccess = () => {
      clearTimeout(timeout);
      const db = req.result;
      // if a future version wants to upgrade while we're open, close so we
      // don't become the blocker for the new tab
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timeout);
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = op(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function saveCurrent(doc: PaintingDoc): Promise<unknown> {
  return tx("kv", "readwrite", (s) => s.put(doc, "current"));
}

export function loadCurrent(): Promise<PaintingDoc | undefined> {
  return tx<PaintingDoc | undefined>("kv", "readonly", (s) => s.get("current") as IDBRequest<PaintingDoc | undefined>);
}

export function galleryPut(item: GalleryItem): Promise<unknown> {
  return tx("gallery", "readwrite", (s) => s.put(item));
}

export async function galleryAll(): Promise<GalleryItem[]> {
  const items = await tx<GalleryItem[]>("gallery", "readonly", (s) => s.getAll() as IDBRequest<GalleryItem[]>);
  return items.sort((a, b) => a.updatedAt - b.updatedAt);
}

export async function galleryByBook(bookId: string): Promise<GalleryItem[]> {
  return (await galleryAll()).filter((i) => i.bookId === bookId);
}

export function galleryDelete(id: string): Promise<unknown> {
  return tx("gallery", "readwrite", (s) => s.delete(id));
}

export function bookPut(book: Book): Promise<unknown> {
  return tx("books", "readwrite", (s) => s.put(book));
}

export async function bookDelete(id: string): Promise<void> {
  const pages = await galleryByBook(id);
  for (const p of pages) await galleryDelete(p.id);
  await tx("books", "readwrite", (s) => s.delete(id));
}

// Lists books oldest-first, creating the first one if none exist, and adopts
// any pages saved before books existed into the first book.
export async function listBooks(): Promise<Book[]> {
  let books = await tx<Book[]>("books", "readonly", (s) => s.getAll() as IDBRequest<Book[]>);
  if (books.length === 0) {
    const first: Book = { id: crypto.randomUUID(), title: "Sketchbook 1", createdAt: Date.now() };
    await bookPut(first);
    books = [first];
  }
  books.sort((a, b) => a.createdAt - b.createdAt);

  const orphans = (await galleryAll()).filter((i) => !i.bookId);
  for (const item of orphans) {
    item.bookId = books[0].id;
    await galleryPut(item);
  }
  return books;
}
