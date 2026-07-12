import "./style.css";
import { PaintEngine } from "./engine/paintEngine";
import { buildToolbar } from "./ui/toolbar";
import { saveCurrent, loadCurrent } from "./engine/persist";

const app = document.querySelector<HTMLDivElement>("#app")!;

const canvasArea = document.createElement("div");
canvasArea.className = "canvas-area";
app.appendChild(canvasArea);

const engine = new PaintEngine(canvasArea);
const toolbar = buildToolbar(engine);
app.appendChild(toolbar);

// Autosave the working painting so power cuts / app kills never lose work.
// Debounced: history events fire per stroke, but serializing a large doc on
// every single stroke while sketching fast would jank.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
engine.onHistory(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCurrent(engine.getDoc()).catch(() => {
      // storage unavailable (private mode, quota) - painting still works
    });
  }, 400);
});

loadCurrent()
  .then((doc) => {
    if (doc && (doc.strokes?.length || doc.fixedSize)) {
      engine.loadDoc(doc);
    }
  })
  .catch(() => {});
