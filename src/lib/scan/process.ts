import { detectDocumentQuad } from "./detect";
import { enhanceImage } from "./enhance";
import { clampQuad, type Quad } from "./geometry";
import { canvasFromImageData, imageDataToJpeg, newPageId, rotateImageData } from "./image";
import { SCAN_JPEG_QUALITY, SCAN_THUMB_EDGE, type EnhancePreset, type ScanPage } from "./types";
import { warpPerspective } from "./warp";

export function processPreview(
  original: ImageData,
  quad: Quad,
  preset: EnhancePreset,
  rotationTurns: number,
): ImageData {
  const bounded = clampQuad(quad, original.width, original.height);
  const warped = warpPerspective(original, bounded);
  const enhanced = enhanceImage(warped, preset);
  return rotateImageData(enhanced, rotationTurns);
}

export async function pageFromProcessed(
  processed: ImageData,
  name: string,
  preset: EnhancePreset,
): Promise<ScanPage> {
  const jpeg = await imageDataToJpeg(processed, SCAN_JPEG_QUALITY);
  const thumb = await imageDataToJpeg(scaleForThumb(processed, SCAN_THUMB_EDGE), 0.72);
  return {
    id: newPageId(),
    name,
    jpeg,
    thumbUrl: URL.createObjectURL(thumb),
    width: processed.width,
    height: processed.height,
    preset,
  };
}

function scaleForThumb(data: ImageData, maxEdge: number): ImageData {
  const scale = Math.min(1, maxEdge / Math.max(data.width, data.height));
  const width = Math.max(1, Math.round(data.width * scale));
  const height = Math.max(1, Math.round(data.height * scale));
  const source = canvasFromImageData(data);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function detectOrFallback(original: ImageData): Quad {
  return detectDocumentQuad(original).quad;
}

export function releasePage(page: ScanPage) {
  URL.revokeObjectURL(page.thumbUrl);
}
