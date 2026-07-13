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

// Everything needed to reconstruct the CURRENT painting session. Older
// strokes get baked into basePng (a flat raster of the paint layer) so that
// restoring never replays an unbounded stroke history - strokes[] only holds
// the recent, unbaked tail. v1 docs (strokes only) still load, progressively.
export interface PaintingDoc {
  v: 1 | 2;
  strokes: Stroke[];
  fixedSize: { w: number; h: number } | null;
  bg: string;
  basePng?: Blob;
}

export interface Book {
  id: string;
  title: string;
  createdAt: number;
}

export interface GalleryItem {
  id: string;
  // which sketchbook this page belongs to; items saved before books existed
  // lack it and get migrated to the first book
  bookId?: string;
  thumb: string; // small JPEG data URL for the page/thumbnail
  // full-resolution PNG captured at save time; items saved before this
  // existed only have the thumb (and possibly a legacy stroke doc, ignored)
  blob?: Blob;
  updatedAt: number;
}
