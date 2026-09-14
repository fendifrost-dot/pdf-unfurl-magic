/**
 * Camera → PDF contract used by the mobile `/scan` shell.
 *
 * The Genius Scan lane owns edge detection, perspective correction, filters,
 * and OCR. This module stays a usable stub: photos become PDF pages locally
 * with no upload.
 *
 * TODO(scan-lane): replace `enhanceScanPage` with deskew / crop / contrast.
 * TODO(scan-lane): add OCR text layer once the scan backend lands.
 * TODO(scan-lane): multi-page session persistence across routes.
 */
import { PDFDocument } from "pdf-lib";

export type ScanPage = {
  id: string;
  name: string;
  /** JPEG bytes after local normalize. */
  jpeg: Uint8Array;
  width: number;
  height: number;
  previewUrl: string;
};

export type ScanSession = {
  pages: ScanPage[];
};

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.84;
/** A4 in PDF points. */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

function revokePreview(page: ScanPage) {
  if (page.previewUrl.startsWith("blob:")) URL.revokeObjectURL(page.previewUrl);
}

export function disposeScanPages(pages: ScanPage[]) {
  pages.forEach(revokePreview);
}

async function blobToUint8(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Draw the capture through a canvas so HEIC/PNG/huge phone photos become a
 * bounded JPEG the rest of the app can embed.
 */
export async function normalizeCapture(
  file: File,
): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "That photo could not be read. Use a JPEG or PNG, or take a new picture with the camera.",
    );
  }

  let width = bitmap.width;
  let height = bitmap.height;
  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("This browser cannot prepare a scan page.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // TODO(scan-lane): run enhanceScanPage(canvas) here before encoding.
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (next) => (next ? resolve(next) : reject(new Error("Could not encode that photo."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });

  return { jpeg: await blobToUint8(blob), width, height };
}

/** Hook for the scan lane — identity transform until enhancement lands. */
export async function enhanceScanPage(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  // TODO(scan-lane): perspective crop, whiteboard / document filters, shadow removal.
  return canvas;
}

export async function pagesFromImageFiles(files: File[]): Promise<ScanPage[]> {
  const images = files.filter(
    (file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name),
  );
  if (images.length === 0) {
    throw new Error("Choose one or more photos to turn into a PDF.");
  }
  const pages: ScanPage[] = [];
  for (const file of images) {
    const normalized = await normalizeCapture(file);
    pages.push({
      id: `scan-${crypto.randomUUID()}`,
      name: file.name || "scan.jpg",
      jpeg: normalized.jpeg,
      width: normalized.width,
      height: normalized.height,
      previewUrl: URL.createObjectURL(
        new Blob([normalized.jpeg.slice(0) as unknown as BlobPart], { type: "image/jpeg" }),
      ),
    });
  }
  return pages;
}

/** Embed each photo as its own A4-ish page. One image in memory at a time. */
export async function buildPdfFromScanPages(pages: ScanPage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("Add at least one page before making a PDF.");
  const doc = await PDFDocument.create();
  const margin = 18;

  for (const page of pages) {
    // TODO(scan-lane): honor detected page bounds instead of letterboxing.
    const image = await doc.embedJpg(page.jpeg);
    const pdfPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const maxW = PAGE_WIDTH - margin * 2;
    const maxH = PAGE_HEIGHT - margin * 2;
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    pdfPage.drawImage(image, {
      x: (PAGE_WIDTH - width) / 2,
      y: (PAGE_HEIGHT - height) / 2,
      width,
      height,
    });
  }

  return doc.save();
}

export function moveScanPage(pages: ScanPage[], id: string, direction: -1 | 1): ScanPage[] {
  const index = pages.findIndex((page) => page.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= pages.length) return pages;
  const copy = pages.slice();
  const item = copy[index];
  if (!item) return pages;
  copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}
