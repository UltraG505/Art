import type { PaintingDoc, GalleryItem } from "./types";

const DB_NAME = "abstract-studio";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("gallery")) db.createObjectStore("gallery", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function galleryDelete(id: string): Promise<unknown> {
  return tx("gallery", "readwrite", (s) => s.delete(id));
}
