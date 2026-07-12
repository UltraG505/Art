export interface StrokePoint {
  x: number;
  y: number;
  t: number;
}

export type BrushId = "wetBlend" | "chalk" | "glow";

export interface Stroke {
  id: string;
  brush: BrushId;
  color: string;
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
