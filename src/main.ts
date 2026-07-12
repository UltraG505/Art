import "./style.css";
import { PaintEngine } from "./engine/paintEngine";
import { buildToolbar } from "./ui/toolbar";

const app = document.querySelector<HTMLDivElement>("#app")!;

const canvasArea = document.createElement("div");
canvasArea.className = "canvas-area";
app.appendChild(canvasArea);

const engine = new PaintEngine(canvasArea);
const toolbar = buildToolbar(engine);
app.appendChild(toolbar);
