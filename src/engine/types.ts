export interface StrokePoint {
  x: number;
  y: number;
  t: number;
  // stylus/screen pressure 0..1 when the device reports it; 0.5 = neutral
  // (mouse / touch without pressure). Optional so old saved docs still load.
  pr?: number;
}

export type BrushId = "wetBlend" | "flow" | "chalk" | "glow" | "ink" | "smudge";

export interface Stroke {
  id: string;
  brush: BrushId;
  color: string;
  // multi-color loadout (1-3 colors) the brush was carrying; color above is
  // always colors[0]. Optional so old saved docs still load.
  colors?: string[];
  size: number;
  seed: number;
  points: StrokePoint[];
}

// Everything needed to reconstruct a painting: the stroke history plus the
// canvas settings the strokes were recorded against.
export interface PaintingDoc {
  v: 1;
  strokes: Stroke[];
  fixedSize: { w: number; h: number } | null;
  bg: string;
}

export interface GalleryItem {
  id: string;
  thumb: string; // small JPEG data URL for the gallery grid
  doc: PaintingDoc;
  updatedAt: number;
}
