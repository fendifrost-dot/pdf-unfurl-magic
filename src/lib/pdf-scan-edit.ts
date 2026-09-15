/**
 * Scan-aware edit: detect image-only / OCR-ghost pages, enhance + OCR locally,
 * and export a text layer on the page image instead of Acrobat-style whiteout.
 *
 * Real text PDFs stay on the pdf-text-edit in-place path.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import { collectTextShows, normalizePdfText, tokenizeContentStream } from "./pdf-content-stream";
import { loadPdfDocument } from "./pdf-io";
import { fitFontSize } from "./text-helpers";
import { canvasToJpeg } from "./image-process";
import { renderPageToImageData, looksGarbled, type TextLine } from "./pdf-runtime";
import { enhanceImage } from "./scan/enhance";
import { canvasFromImageData } from "./scan/image";
import { recognizePageLines, groupOcrWords } from "./scan/ocr";
import { setFillTextMode, setInvisibleOcrTextMode } from "./scan/pdf";
import type { EnhancePreset, OcrLineBox } from "./scan/types";
import type { PDFDocumentProxy } from "pdfjs-dist";

export { groupOcrWords };

export const SCAN_EDIT_MAX_EDGE = 1600;
export const SCAN_EDIT_UPSCALE_MIN = 1100;

export type PageScanReason = "ok" | "image-only" | "ocr-ghost" | "no-operators";

export type PageScanReport = {
  looksScanned: boolean;
  reason: PageScanReason;
  message: string;
  showCount: number;
  imageCount: number;
  pdfJsLineCount: number;
  matchedLineCount: number;
  matchRatio: number;
};

export type ScanJpeg = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type ScanPageSession = {
  preset: EnhancePreset;
  replaceWithCleaned: boolean;
  originalJpeg?: ScanJpeg;
  enhancedJpeg?: ScanJpeg;
  enhancedPreviewUrl?: string;
  ocrLines: TextLine[];
  pageWidth?: number;
  pageHeight?: number;
};

export type ScanLineEdit = {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  text: string;
  originalText: string;
};

export type ScanPageExport = {
  page: number;
  imageBytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  lines: ScanLineEdit[];
};

function decodeStream(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) {
    return decodePDFRawStream(stream).decode();
  }
  const withUnencoded = stream as PDFStream & { getUnencodedContents?: () => Uint8Array };
  if (typeof withUnencoded.getUnencodedContents === "function") {
    return withUnencoded.getUnencodedContents();
  }
  return stream.getContents();
}

function streamDict(stream: PDFStream): PDFDict | null {
  if ("dict" in stream && stream.dict instanceof PDFDict) return stream.dict;
  return null;
}

function asStream(doc: PDFDocument, item: unknown): PDFStream | null {
  const obj = item instanceof PDFRef ? doc.context.lookup(item) : item;
  return obj instanceof PDFStream ? obj : null;
}

function subtypeName(dict: PDFDict | null): string {
  if (!dict) return "";
  const subtype = dict.lookup(PDFName.of("Subtype"));
  return subtype instanceof PDFName ? subtype.decodeText() : "";
}

function collectStreamShows(stream: PDFStream): string[] {
  return collectTextShows(tokenizeContentStream(decodeStream(stream))).map((show) => show.text);
}

function walkForm(
  doc: PDFDocument,
  stream: PDFStream,
  acc: { shows: string[]; images: number },
  seen: Set<number>,
) {
  acc.shows.push(...collectStreamShows(stream));
  const dict = streamDict(stream);
  const resources = dict?.lookupMaybe(PDFName.of("Resources"), PDFDict);
  if (resources) walkResources(doc, resources, acc, seen);
}

function walkResources(
  doc: PDFDocument,
  resources: PDFDict,
  acc: { shows: string[]; images: number },
  seen: Set<number>,
) {
  const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return;
  for (const [, value] of xobjects.entries()) {
    const refTag = value instanceof PDFRef ? value.tag : null;
    if (refTag !== null) {
      if (seen.has(refTag)) continue;
      seen.add(refTag);
    }
    const stream = asStream(doc, value);
    if (!stream) continue;
    const subtype = subtypeName(streamDict(stream));
    if (subtype === "Image") {
      acc.images += 1;
      continue;
    }
    if (subtype === "Form") walkForm(doc, stream, acc, seen);
  }
}

function pageContentStreams(doc: PDFDocument, page: PDFPage): PDFStream[] {
  const contents = page.node.Contents();
  if (!contents) return [];
  if (contents instanceof PDFArray) {
    const out: PDFStream[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const stream = asStream(doc, contents.get(i));
      if (stream) out.push(stream);
    }
    return out;
  }
  if (contents instanceof PDFStream) return [contents];
  return [];
}

export function matchPdfJsLines(
  shown: string[],
  pdfJsLineTexts: string[],
): {
  matchedLineCount: number;
  matchRatio: number;
  pdfJsLineCount: number;
} {
  const usable = pdfJsLineTexts.map(normalizePdfText).filter(Boolean);
  const norms = shown.map(normalizePdfText).filter(Boolean);
  let matchedLineCount = 0;
  for (const line of usable) {
    if (norms.some((text) => text === line)) matchedLineCount += 1;
  }
  return {
    matchedLineCount,
    pdfJsLineCount: usable.length,
    matchRatio: usable.length === 0 ? 1 : matchedLineCount / usable.length,
  };
}

export function classifyPageScan(input: {
  showCount: number;
  imageCount: number;
  pdfJsLineCount: number;
  matchRatio: number;
  garbledRatio?: number;
}): Pick<PageScanReport, "looksScanned" | "reason" | "message"> {
  const { showCount, imageCount, pdfJsLineCount, matchRatio, garbledRatio = 0 } = input;

  if (showCount === 0 && imageCount > 0) {
    return {
      looksScanned: true,
      reason: "image-only",
      message:
        "This page looks scanned. There is a page image and no text operator to rewrite — Enhance page and OCR to edit amounts or labels.",
    };
  }

  if (showCount === 0) {
    return {
      looksScanned: true,
      reason: "no-operators",
      message:
        "This page has no text operators. Export will not paint over missing runs. Enhance page and OCR instead.",
    };
  }

  if (imageCount > 0 && pdfJsLineCount >= 1 && matchRatio < 0.35 && garbledRatio < 0.45) {
    return {
      looksScanned: true,
      reason: "ocr-ghost",
      message:
        "This page looks scanned. Selectable text is not a reliable PDF operator (OCR ghost or TouchUp junk). Enhance page and OCR rather than rewriting Helvetica over the image.",
    };
  }

  return { looksScanned: false, reason: "ok", message: "" };
}

export async function inspectPageScan(
  bytes: ArrayBuffer,
  pageNumber: number,
  pdfJsLineTexts: string[] = [],
): Promise<PageScanReport> {
  const doc = await loadPdfDocument(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) {
    return {
      looksScanned: false,
      reason: "ok",
      message: "",
      showCount: 0,
      imageCount: 0,
      pdfJsLineCount: pdfJsLineTexts.length,
      matchedLineCount: 0,
      matchRatio: 0,
    };
  }

  const acc = { shows: [] as string[], images: 0 };
  const seen = new Set<number>();
  for (const stream of pageContentStreams(doc, page)) {
    acc.shows.push(...collectStreamShows(stream));
  }
  const resources = page.node.Resources();
  if (resources) walkResources(doc, resources, acc, seen);

  const { matchedLineCount, matchRatio, pdfJsLineCount } = matchPdfJsLines(
    acc.shows,
    pdfJsLineTexts,
  );
  const garbledRatio =
    acc.shows.length === 0
      ? 0
      : acc.shows.filter((show) => looksGarbled(show)).length / acc.shows.length;
  const classified = classifyPageScan({
    showCount: acc.shows.length,
    imageCount: acc.images,
    pdfJsLineCount,
    matchRatio,
    garbledRatio,
  });

  return {
    ...classified,
    showCount: acc.shows.length,
    imageCount: acc.images,
    pdfJsLineCount,
    matchedLineCount,
    matchRatio,
  };
}

export function ocrBoxesToTextLines(
  boxes: OcrLineBox[],
  pageNumber: number,
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
): TextLine[] {
  const iw = Math.max(imageWidth, 1);
  const ih = Math.max(imageHeight, 1);
  return boxes.map((box, index) => {
    const x = (box.x0 / iw) * pageWidth;
    const width = Math.max(((box.x1 - box.x0) / iw) * pageWidth, 8);
    const height = Math.max(((box.y1 - box.y0) / ih) * pageHeight, 8);
    const y = pageHeight - (box.y1 / ih) * pageHeight;
    return {
      id: `p${pageNumber}-ocr-${index}-${Math.round(x)}-${Math.round(y)}`,
      page: pageNumber,
      text: box.text,
      x,
      y,
      width,
      height,
      fontSize: Math.max(4, height * 0.85),
      fontName: "OCR",
      fontFamily: "Helvetica",
      source: "ocr" as const,
      confidence: box.confidence,
    };
  });
}

function upscaleIfSmall(data: ImageData, minEdge: number, maxEdge: number): ImageData {
  const edge = Math.max(data.width, data.height);
  if (edge >= minEdge) return data;
  const scale = Math.min(maxEdge / edge, minEdge / edge);
  const width = Math.max(1, Math.round(data.width * scale));
  const height = Math.max(1, Math.round(data.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return data;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvasFromImageData(data), 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export async function enhancePageForScan(
  proxy: PDFDocumentProxy,
  pageNumber: number,
  preset: EnhancePreset,
): Promise<{
  originalJpeg: ScanJpeg;
  enhancedJpeg: ScanJpeg;
  enhancedCanvas: HTMLCanvasElement;
  pageWidth: number;
  pageHeight: number;
}> {
  const rendered = await renderPageToImageData(proxy, pageNumber, SCAN_EDIT_MAX_EDGE);
  const originalJpeg = await canvasToJpeg(rendered.canvas, 0.84);
  const prepared = upscaleIfSmall(rendered.data, SCAN_EDIT_UPSCALE_MIN, SCAN_EDIT_MAX_EDGE);
  const enhanced = enhanceImage(prepared, preset);
  const enhancedCanvas = canvasFromImageData(enhanced);
  const enhancedJpeg = await canvasToJpeg(enhancedCanvas, 0.84);
  return {
    originalJpeg,
    enhancedJpeg,
    enhancedCanvas,
    pageWidth: rendered.pageWidth,
    pageHeight: rendered.pageHeight,
  };
}

export async function ocrCanvasToLines(
  canvas: HTMLCanvasElement,
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
): Promise<TextLine[]> {
  const boxes = await recognizePageLines(canvas);
  return ocrBoxesToTextLines(boxes, pageNumber, canvas.width, canvas.height, pageWidth, pageHeight);
}

function imageMagic(bytes: Uint8Array): "image/jpeg" | "image/png" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return "image/png";
}

async function drawScanPage(doc: PDFDocument, page: PDFPage, patch: ScanPageExport) {
  const { width, height } = page.getSize();
  const mime = imageMagic(patch.imageBytes);
  const image =
    mime === "image/png"
      ? await doc.embedPng(patch.imageBytes)
      : await doc.embedJpg(patch.imageBytes);
  page.drawImage(image, { x: 0, y: 0, width, height });

  if (patch.lines.length === 0) return;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of patch.lines) {
    const text = line.text.replace(/\s*\n\s*/g, " ").trim();
    if (!text) continue;
    const original = line.originalText.replace(/\s*\n\s*/g, " ").trim();
    const changed = normalizePdfText(text) !== normalizePdfText(original);
    const size = Math.max(
      4,
      fitFontSize(text, line.fontSize || Math.max(4, line.height * 0.85), line.width),
    );
    const x = Math.max(0, line.x);
    const y = Math.max(0, line.y);
    const boxW = Math.max(8, line.width);
    const boxH = Math.max(8, line.height);
    try {
      if (changed) {
        setFillTextMode(page);
        page.drawRectangle({
          x,
          y,
          width: boxW,
          height: boxH,
          color: rgb(1, 1, 1),
        });
        page.drawText(text, {
          x,
          y: y + Math.max(1, (boxH - size) * 0.2),
          size,
          font,
          color: rgb(0.08, 0.08, 0.1),
          maxWidth: boxW,
        });
      } else {
        setInvisibleOcrTextMode(page);
        page.drawText(text, {
          x,
          y: y + Math.max(1, (boxH - size) * 0.2),
          size,
          font,
          color: rgb(0, 0, 0),
          maxWidth: boxW,
        });
      }
    } catch {
      // Skip a line Helvetica cannot encode rather than writing "?".
    }
  }
}

/**
 * Rebuild only the listed pages as image + OCR text layer. Other pages are
 * copied as PDF objects so vector edits elsewhere stay intact.
 */
export async function applyScanPagePatches(
  bytes: ArrayBuffer,
  patches: ScanPageExport[],
): Promise<Uint8Array> {
  if (patches.length === 0) {
    const doc = await loadPdfDocument(bytes);
    return doc.save({ useObjectStreams: false, addDefaultPage: false });
  }

  const src = await loadPdfDocument(bytes);
  const out = await PDFDocument.create();
  const byPage = new Map(patches.map((patch) => [patch.page, patch]));

  for (let i = 0; i < src.getPageCount(); i++) {
    const patch = byPage.get(i + 1);
    if (!patch) {
      const [copied] = await out.copyPages(src, [i]);
      out.addPage(copied);
      continue;
    }
    const sourcePage = src.getPage(i);
    const size = sourcePage.getSize();
    const page = out.addPage([size.width, size.height]);
    await drawScanPage(out, page, patch);
  }

  return out.save({ useObjectStreams: false, addDefaultPage: false });
}

export function emptyScanSession(preset: EnhancePreset = "receipt"): ScanPageSession {
  return { preset, replaceWithCleaned: false, ocrLines: [] };
}

export function releaseScanSession(session?: ScanPageSession | null) {
  if (session?.enhancedPreviewUrl) URL.revokeObjectURL(session.enhancedPreviewUrl);
}
