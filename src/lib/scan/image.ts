import { SCAN_MAX_EDGE } from "./types";

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  return ctx;
}

export function imageDataFromCanvas(canvas: HTMLCanvasElement): ImageData {
  return canvasContext(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

export function canvasFromImageData(data: ImageData): HTMLCanvasElement {
  const canvas = makeCanvas(data.width, data.height);
  canvasContext(canvas).putImageData(data, 0, 0);
  return canvas;
}

export function cloneImageData(data: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
}

export async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

export function drawSourceToImageData(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = SCAN_MAX_EDGE,
): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = makeCanvas(width, height);
  const ctx = canvasContext(canvas);
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export async function imageDataFromFile(file: File, maxEdge = SCAN_MAX_EDGE): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  try {
    return drawSourceToImageData(bitmap, bitmap.width, bitmap.height, maxEdge);
  } finally {
    bitmap.close();
  }
}

export async function imageDataToJpeg(data: ImageData, quality: number): Promise<Blob> {
  const canvas = canvasFromImageData(data);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (next) => (next ? resolve(next) : reject(new Error("Could not encode the page."))),
      "image/jpeg",
      quality,
    );
  });
  return blob;
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export function rotateImageData(data: ImageData, turns: number): ImageData {
  const quarter = ((turns % 4) + 4) % 4;
  if (quarter === 0) return cloneImageData(data);
  const src = data.data;
  const w = data.width;
  const h = data.height;
  const outW = quarter % 2 === 0 ? w : h;
  const outH = quarter % 2 === 0 ? h : w;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let nx = x;
      let ny = y;
      if (quarter === 1) {
        nx = h - 1 - y;
        ny = x;
      } else if (quarter === 2) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else if (quarter === 3) {
        nx = y;
        ny = w - 1 - x;
      }
      const o = (ny * outW + nx) * 4;
      out[o] = src[i]!;
      out[o + 1] = src[i + 1]!;
      out[o + 2] = src[i + 2]!;
      out[o + 3] = src[i + 3]!;
    }
  }
  return new ImageData(out, outW, outH);
}

export function downscaleImageData(data: ImageData, maxEdge: number): ImageData {
  if (Math.max(data.width, data.height) <= maxEdge) return cloneImageData(data);
  return drawSourceToImageData(canvasFromImageData(data), data.width, data.height, maxEdge);
}

export function newPageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
