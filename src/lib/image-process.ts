/** Canvas-only image adjustments. Operates on the selected photo, never the whole PDF. */

export const MAX_WORKING_EDGE = 1600;
export const PREVIEW_EDGE = 320;

export type RotateDeg = 0 | 90 | 180 | 270;

export type ImageAdjustments = {
  rotate: RotateDeg;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  cropLeft: number;
  exposure: number;
  contrast: number;
  quality: number;
};

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  rotate: 0,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
  exposure: 0,
  contrast: 0,
  quality: 0.72,
};

export function containFit(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

export function nextRotate(current: RotateDeg, direction: -1 | 1): RotateDeg {
  const stepped = (current + direction * 90 + 360) % 360;
  return stepped as RotateDeg;
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  const anySource = source as { width?: number; height?: number };
  return { width: anySource.width ?? 0, height: anySource.height ?? 0 };
}

export function canvasFromSource(
  source: CanvasImageSource,
  maxEdge = MAX_WORKING_EDGE,
): HTMLCanvasElement {
  const { width, height } = sourceSize(source);
  if (!width || !height) throw new Error("That image has no pixel size.");
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function applyTone(data: Uint8ClampedArray, exposure: number, contrast: number) {
  const exp = Math.pow(2, exposure);
  const factor = (1 + contrast) / Math.max(0.0001, 1 - contrast);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = (data[i + c] ?? 0) * exp;
      v = (v - 128) * factor + 128;
      data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

export function renderAdjustedCanvas(
  source: HTMLCanvasElement,
  adj: ImageAdjustments,
): HTMLCanvasElement {
  const insetL = Math.min(0.45, Math.max(0, adj.cropLeft));
  const insetR = Math.min(0.45, Math.max(0, adj.cropRight));
  const insetT = Math.min(0.45, Math.max(0, adj.cropTop));
  const insetB = Math.min(0.45, Math.max(0, adj.cropBottom));
  const sx = Math.round(source.width * insetL);
  const sy = Math.round(source.height * insetT);
  const sw = Math.max(1, Math.round(source.width * (1 - insetL - insetR)));
  const sh = Math.max(1, Math.round(source.height * (1 - insetT - insetB)));

  const rotated = adj.rotate === 90 || adj.rotate === 270;
  const out = document.createElement("canvas");
  out.width = rotated ? sh : sw;
  out.height = rotated ? sw : sh;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");

  ctx.save();
  if (adj.rotate === 90) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (adj.rotate === 180) {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  } else if (adj.rotate === 270) {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();

  if (adj.exposure !== 0 || adj.contrast !== 0) {
    const imageData = ctx.getImageData(0, 0, out.width, out.height);
    applyTone(imageData.data, adj.exposure, adj.contrast);
    ctx.putImageData(imageData, 0, 0);
  }
  return out;
}

export function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const q = Math.min(0.95, Math.max(0.28, quality));
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("Could not compress that image."));
          return;
        }
        const buffer = await blob.arrayBuffer();
        resolve({ bytes: new Uint8Array(buffer), width: canvas.width, height: canvas.height });
      },
      "image/jpeg",
      q,
    );
  });
}

export async function fileToWorkingCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    return canvasFromSource(bitmap, MAX_WORKING_EDGE);
  } finally {
    bitmap.close();
  }
}
