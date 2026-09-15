import type { Quad } from "./geometry";

export type EnhancePreset = "color" | "whiteboard" | "receipt" | "bw";

export const ENHANCE_PRESETS: Array<{ id: EnhancePreset; label: string; hint: string }> = [
  { id: "color", label: "Color doc", hint: "Keep print color, even lighting" },
  { id: "whiteboard", label: "Whiteboard", hint: "Flatten glare, keep marker ink" },
  { id: "receipt", label: "Receipt", hint: "Gray, high contrast, thin type" },
  { id: "bw", label: "B&W", hint: "Ink on paper, smallest file" },
];

export type OcrWord = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
};

/** Pixel-space OCR line (origin top-left, same as the source bitmap). */
export type OcrLineBox = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
  words?: OcrWord[];
};

export type ScanPage = {
  id: string;
  name: string;
  jpeg: Blob;
  thumbUrl: string;
  width: number;
  height: number;
  preset: EnhancePreset;
};

export type DetectedDocument = {
  quad: Quad;
  confidence: number;
};

export const SCAN_MAX_EDGE = 1800;
export const SCAN_DETECT_EDGE = 360;
export const SCAN_THUMB_EDGE = 220;
export const SCAN_JPEG_QUALITY = 0.84;
