/**
 * Page rotate. Writes PDF /Rotate (0 / 90 / 180 / 270) via pdf-lib
 * page.setRotation / getRotation. Content streams, fonts, and AcroForm
 * widgets stay in user space — the page dict flag is what Acrobat uses.
 *
 * Session UI stores an absolute angle per page; Save As applies those
 * values. The file that was opened is never written.
 */
import { PDFDocument, degrees, type PDFPage } from "pdf-lib";
import { bytesToArrayBuffer, loadPdfDocument, PdfEncryptedMutationError } from "./pdf-io";

export type PageRotateDeg = 0 | 90 | 180 | 270;

/** 1-based page + absolute /Rotate to write. */
export type PageRotation = {
  page: number;
  degrees: PageRotateDeg;
};

export const ROTATE_LEFT_LABEL = "Rotate left";
export const ROTATE_RIGHT_LABEL = "Rotate right";
export const ROTATE_180_LABEL = "Rotate 180°";

export const ROTATE_LEFT_DELTA = -90;
export const ROTATE_RIGHT_DELTA = 90;
export const ROTATE_180_DELTA = 180;

export type Affine = [number, number, number, number, number, number];
export type PdfViewBox = readonly [number, number, number, number];

export function normalizeRotateDeg(angle: number): PageRotateDeg {
  if (!Number.isFinite(angle)) return 0;
  const stepped = Math.round(angle / 90) * 90;
  const wrapped = ((stepped % 360) + 360) % 360;
  if (wrapped === 90 || wrapped === 180 || wrapped === 270) return wrapped;
  return 0;
}

export function addRotateDeg(current: number, delta: number): PageRotateDeg {
  return normalizeRotateDeg(current + delta);
}

export function rotationToDegrees(rotation: { type?: string; angle: number } | number): number {
  if (typeof rotation === "number") return rotation;
  if (rotation.type === "radians") return (rotation.angle * 180) / Math.PI;
  return rotation.angle;
}

export function pageRotationOf(page: PDFPage): PageRotateDeg {
  return normalizeRotateDeg(rotationToDegrees(page.getRotation()));
}

/**
 * Acrobat-style clockwise /Rotate. 90 and 270 swap the displayed width/height.
 * Matches pdf.js PageViewport (dontFlip = false) for viewBox + scale + rotation.
 */
export function pdfjsPageViewport(
  viewBox: PdfViewBox,
  scale: number,
  rotation: number,
): { transform: Affine; width: number; height: number } {
  const deg = normalizeRotateDeg(rotation);
  const centerX = (viewBox[2] + viewBox[0]) / 2;
  const centerY = (viewBox[3] + viewBox[1]) / 2;
  let rotateA = 1;
  let rotateB = 0;
  let rotateC = 0;
  let rotateD = -1;
  if (deg === 90) {
    rotateA = 0;
    rotateB = 1;
    rotateC = 1;
    rotateD = 0;
  } else if (deg === 180) {
    rotateA = -1;
    rotateB = 0;
    rotateC = 0;
    rotateD = 1;
  } else if (deg === 270) {
    rotateA = 0;
    rotateB = -1;
    rotateC = -1;
    rotateD = 0;
  }

  let offsetCanvasX: number;
  let offsetCanvasY: number;
  let width: number;
  let height: number;
  if (rotateA === 0) {
    offsetCanvasX = Math.abs(centerY - viewBox[1]) * scale;
    offsetCanvasY = Math.abs(centerX - viewBox[0]) * scale;
    width = Math.abs(viewBox[3] - viewBox[1]) * scale;
    height = Math.abs(viewBox[2] - viewBox[0]) * scale;
  } else {
    offsetCanvasX = Math.abs(centerX - viewBox[0]) * scale;
    offsetCanvasY = Math.abs(centerY - viewBox[1]) * scale;
    width = Math.abs(viewBox[2] - viewBox[0]) * scale;
    height = Math.abs(viewBox[3] - viewBox[1]) * scale;
  }

  const transform: Affine = [
    rotateA * scale,
    rotateB * scale,
    rotateC * scale,
    rotateD * scale,
    offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY,
    offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY,
  ];
  return { transform, width, height };
}

export function applyAffine(transform: Affine, x: number, y: number): { x: number; y: number } {
  return {
    x: transform[0] * x + transform[2] * y + transform[4],
    y: transform[1] * x + transform[3] * y + transform[5],
  };
}

export function invertAffine(t: Affine): Affine {
  const det = t[0] * t[3] - t[1] * t[2];
  if (det === 0) return [1, 0, 0, 1, 0, 0];
  const a = t[3] / det;
  const b = -t[1] / det;
  const c = -t[2] / det;
  const d = t[0] / det;
  return [a, b, c, d, -(a * t[4] + c * t[5]), -(b * t[4] + d * t[5])];
}

export function pdfPointToViewport(
  x: number,
  y: number,
  viewBox: PdfViewBox,
  scale: number,
  rotation: number,
): { x: number; y: number } {
  return applyAffine(pdfjsPageViewport(viewBox, scale, rotation).transform, x, y);
}

export function viewportPointToPdf(
  x: number,
  y: number,
  viewBox: PdfViewBox,
  scale: number,
  rotation: number,
): { x: number; y: number } {
  const { transform } = pdfjsPageViewport(viewBox, scale, rotation);
  return applyAffine(invertAffine(transform), x, y);
}

/** Axis-aligned PDF rect → CSS box in the rotated viewport. */
export function pdfRectToViewportBox(
  x: number,
  y: number,
  width: number,
  height: number,
  viewBox: PdfViewBox,
  scale: number,
  rotation: number,
): { x: number; y: number; width: number; height: number } {
  const { transform } = pdfjsPageViewport(viewBox, scale, rotation);
  const corners = [
    applyAffine(transform, x, y),
    applyAffine(transform, x + width, y),
    applyAffine(transform, x, y + height),
    applyAffine(transform, x + width, y + height),
  ];
  const left = Math.min(...corners.map((p) => p.x));
  const top = Math.min(...corners.map((p) => p.y));
  const right = Math.max(...corners.map((p) => p.x));
  const bottom = Math.max(...corners.map((p) => p.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function viewBoxFromSize(width: number, height: number): PdfViewBox {
  return [0, 0, width, height];
}

export function displayPageRotation(
  session: Record<number, PageRotateDeg>,
  page: number,
  original: PageRotateDeg,
): PageRotateDeg {
  return session[page] ?? original;
}

/** Clockwise (positive) or counter-clockwise (negative) step for one page. */
export function stepSessionRotation(
  session: Record<number, PageRotateDeg>,
  page: number,
  original: PageRotateDeg,
  delta: number,
): Record<number, PageRotateDeg> {
  const next = addRotateDeg(displayPageRotation(session, page, original), delta);
  const out: Record<number, PageRotateDeg> = { ...session };
  if (next === original) delete out[page];
  else out[page] = next;
  return out;
}

export function sessionRotationList(session: Record<number, PageRotateDeg>): PageRotation[] {
  return Object.entries(session)
    .map(([page, angle]) => ({ page: Number(page), degrees: angle }))
    .filter((item) => Number.isInteger(item.page) && item.page >= 1)
    .sort((a, b) => a.page - b.page);
}

export function pendingRotationCount(session: Record<number, PageRotateDeg>): number {
  return sessionRotationList(session).length;
}

export function applyPageRotationsToDocument(doc: PDFDocument, rotations: PageRotation[]): void {
  if (!rotations.length) return;
  const pages = doc.getPages();
  for (const rot of rotations) {
    const page = pages[rot.page - 1];
    if (!page) continue;
    page.setRotation(degrees(normalizeRotateDeg(rot.degrees)));
  }
}

export async function inspectPageLayout(bytes: ArrayBuffer): Promise<{
  rotations: PageRotateDeg[];
  viewBoxes: PdfViewBox[];
}> {
  let doc;
  try {
    doc = await loadPdfDocument(bytes);
  } catch (error) {
    // /Rotate and MediaBox are numbers; ignoreEncryption is safe for this read.
    // applyPageRotations still refuses encryption so Save As cannot corrupt.
    if (!(error instanceof PdfEncryptedMutationError)) throw error;
    doc = await PDFDocument.load(bytes.slice(0), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  }
  const pages = doc.getPages();
  return {
    rotations: pages.map((page) => pageRotationOf(page)),
    viewBoxes: pages.map((page) => {
      const { width, height } = page.getSize();
      return viewBoxFromSize(width, height);
    }),
  };
}

export async function listPageRotations(bytes: ArrayBuffer): Promise<PageRotateDeg[]> {
  return (await inspectPageLayout(bytes)).rotations;
}

export async function listPageViewBoxes(bytes: ArrayBuffer): Promise<PdfViewBox[]> {
  return (await inspectPageLayout(bytes)).viewBoxes;
}

/**
 * Set absolute /Rotate on the given pages. Other pages are left as they are.
 * Operates on a copy; `bytes` is not mutated.
 */
export async function applyPageRotations(
  bytes: ArrayBuffer,
  rotations: PageRotation[],
): Promise<Uint8Array> {
  const doc = await loadPdfDocument(bytes);
  applyPageRotationsToDocument(doc, rotations);
  return doc.save();
}

/**
 * Add `delta` (multiple of 90) to each listed 1-based page's current /Rotate.
 */
export async function rotatePagesBy(
  bytes: ArrayBuffer,
  pages: number[],
  delta: number,
): Promise<Uint8Array> {
  const doc = await loadPdfDocument(bytes);
  const all = doc.getPages();
  const rotations: PageRotation[] = [];
  for (const pageNumber of pages) {
    const page = all[pageNumber - 1];
    if (!page) continue;
    rotations.push({
      page: pageNumber,
      degrees: addRotateDeg(pageRotationOf(page), delta),
    });
  }
  applyPageRotationsToDocument(doc, rotations);
  return doc.save();
}

export function bytesFromPdf(bytes: Uint8Array): ArrayBuffer {
  return bytesToArrayBuffer(bytes);
}
