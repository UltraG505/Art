import "./style.css";
import { PaintEngine } from "./engine/paintEngine";
import { buildToolbar } from "./ui/toolbar";
import { saveCurrent, loadCurrent } from "./engine/persist";
import { openLibrary } from "./ui/sketchbook";

const app = document.querySelector<HTMLDivElement>("#app")!;

const canvasArea = document.createElement("div");
canvasArea.className = "canvas-area";
app.appendChild(canvasArea);

const engine = new PaintEngine(canvasArea);
const toolbar = buildToolbar(engine);
app.appendChild(toolbar);

// ask the browser not to evict our IndexedDB under storage pressure - the
// library lives entirely on-device
navigator.storage?.persist?.().catch(() => {});

// Autosave the working painting so power cuts / app kills never lose work.
// Debounced and deferred to idle time: serializing a large stroke doc on the
// main thread mid-sketch is one of the things that caused visible freezes.
const scheduleIdle: (cb: () => void) => void =
  "requestIdleCallback" in window
    ? (cb) => (window as Window & typeof globalThis).requestIdleCallback(() => cb(), { timeout: 2000 })
    : (cb) => setTimeout(cb, 250);

let saveTimer: ReturnType<typeof setTimeout> | undefined;
engine.onHistory(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    scheduleIdle(() => {
      saveCurrent(engine.getDoc()).catch(() => {
        // storage unavailable (private mode, quota) - painting still works
      });
    });
  }, 500);
});

// the library is the home screen; open it immediately so boot never waits
// on storage, and restore the working canvas behind it (progressively, so a
// large session can't freeze the UI)
openLibrary(engine);
loadCurrent()
  .then(async (doc) => {
    if (doc && (doc.strokes?.length || doc.basePng || doc.fixedSize)) {
      await engine.loadDoc(doc);
    }
  })
  .catch(() => {});
