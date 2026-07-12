export interface StrokePoint {
  x: number;
  y: number;
  t: number;
}

export type BrushId = "wetBlend";

export interface Stroke {
  id: string;
  brush: BrushId;
  color: string;
  size: number;
  seed: number;
  points: StrokePoint[];
}
