/**
 * In-PDF image studio helpers. Detect photos on the current page via PDF.js,
 * decode only the selected image, and write replacements with pdf-lib without
 * rasterizing the rest of the page.
 */
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { getPdfJs } from "./pdf-runtime";
import { canvasFromSource, type ImageAdjustments } from "./image-process";

export type PdfImageRegion = {
  id: string;
  page: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
};

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function waitForObject(objs: PDFPageProxy["objs"], name: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      objs.get(name, finish);
    } catch (error) {
      settled = true;
      reject(error);
      return;
    }
    setTimeout(() => {
      if (!settled) reject(new Error(`Image “${name}” did not finish loading.`));
    }, 8000);
  });
}

function pixelSize(obj: unknown): { width: number; height: number } {
  if (!obj || typeof obj !== "object") return { width: 0, height: 0 };
  const record = obj as {
    width?: number;
    height?: number;
    bitmap?: { width?: number; height?: number };
  };
  return {
    width: record.width || record.bitmap?.width || 0,
    height: record.height || record.bitmap?.height || 0,
  };
}

const MIN_AREA = 220;

export async function extractImages(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfImageRegion[]> {
  const page = await doc.getPage(pageNumber);
  const pdfjs = await getPdfJs();
  const ops = await page.getOperatorList();
  const { OPS } = pdfjs;

  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const images: PdfImageRegion[] = [];
  let index = 0;

  const paintOps = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
  ]);

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];

    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform && args?.length >= 6) {
      ctm = multiply(ctm, args as Matrix);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = args?.[0];
      if (Array.isArray(matrix) && matrix.length >= 6) ctm = multiply(ctm, matrix as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn !== undefined && paintOps.has(fn)) {
      const corners = [
        applyMatrix(ctm, 0, 0),
        applyMatrix(ctm, 1, 0),
        applyMatrix(ctm, 1, 1),
        applyMatrix(ctm, 0, 1),
      ];
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const width = Math.max(...xs) - x;
      const height = Math.max(...ys) - y;
      if (width * height < MIN_AREA) continue;

      const name = typeof args?.[0] === "string" ? args[0] : `inline-${pageNumber}-${index}`;
      let pixelWidth = 0;
      let pixelHeight = 0;
      if (typeof args?.[0] === "string") {
        try {
          if (page.objs.has(name)) {
            const size = pixelSize(page.objs.get(name));
            pixelWidth = size.width;
            pixelHeight = size.height;
          } else if (page.commonObjs.has(name)) {
            const size = pixelSize(page.commonObjs.get(name));
            pixelWidth = size.width;
            pixelHeight = size.height;
          }
        } catch {
          // Object not resolved yet — size is optional for hit-testing.
        }
      }

      images.push({
        id: `p${pageNumber}-img${index}`,
        page: pageNumber,
        name,
        x,
        y,
        width,
        height,
        pixelWidth,
        pixelHeight,
      });
      index += 1;
    }
  }

  return images;
}

function pixelsToImageData(obj: {
  data: ArrayLike<number>;
  width: number;
  height: number;
}): ImageData {
  const { width, height, data } = obj;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (data.length === rgba.length) {
    rgba.set(data);
  } else if (data.length === width * height * 3) {
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j] = data[i] ?? 0;
      rgba[j + 1] = data[i + 1] ?? 0;
      rgba[j + 2] = data[i + 2] ?? 0;
      rgba[j + 3] = 255;
    }
  } else if (data.length === width * height) {
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      rgba[j] = rgba[j + 1] = rgba[j + 2] = data[i] as number;
      rgba[j + 3] = 255;
    }
  } else {
    throw new Error("Unsupported image pixel format.");
  }
  return new ImageData(rgba, width, height);
}

export async function decodePageImage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  name: string,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  let obj: unknown;
  try {
    obj = await waitForObject(page.objs, name);
  } catch {
    obj = await waitForObject(page.commonObjs, name);
  }
  if (!obj) throw new Error("That image could not be decoded.");

  if (typeof ImageBitmap !== "undefined" && obj instanceof ImageBitmap) {
    return canvasFromSource(obj);
  }
  if (typeof HTMLImageElement !== "undefined" && obj instanceof HTMLImageElement) {
    return canvasFromSource(obj);
  }

  const record = obj as {
    bitmap?: ImageBitmap | HTMLCanvasElement;
    width?: number;
    height?: number;
    data?: ArrayLike<number>;
  };
  if (record.bitmap) return canvasFromSource(record.bitmap);
  if (record.data && record.width && record.height) {
    const canvas = document.createElement("canvas");
    canvas.width = record.width;
    canvas.height = record.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");
    ctx.putImageData(
      pixelsToImageData({ data: record.data, width: record.width, height: record.height }),
      0,
      0,
    );
    return canvasFromSource(canvas);
  }
  if (
    record.width &&
    record.height &&
    typeof HTMLCanvasElement !== "undefined" &&
    obj instanceof HTMLCanvasElement
  ) {
    return canvasFromSource(obj);
  }
  throw new Error("That embedded image is in a format this studio cannot open.");
}

export type ImagePatch = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  /**
   * Resource name from the page (`Im0`, `Image`, …). PDF.js `img_p*` ids and
   * inline-image placeholders are ignored; bbox matching is used instead.
   */
  name?: string;
};

/** `redact` is Cover box (visual only). `erase` is permanent redaction. */
export type AnnotationKind = "rect" | "redact" | "erase" | "highlight" | "underline" | "note";

export type AnnotationBurn = {
  id: string;
  page: number;
  kind: AnnotationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  /**
   * Query that produced this mark via Find and permanently redact.
   * Only set on `kind: "erase"`. Cover boxes never carry this.
   */
  searchQuery?: string;
};

export type ImageEdit = {
  region: PdfImageRegion;
  adjustments: ImageAdjustments;
  replacementName?: string;
  replacementBytes?: Uint8Array;
  output: { bytes: Uint8Array; width: number; height: number };
};

export function jpegMagic(bytes: Uint8Array): "image/jpeg" | "image/png" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  return "image/png";
}
