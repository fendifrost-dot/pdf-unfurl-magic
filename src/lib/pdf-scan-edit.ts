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
import {
  collectTextShows,
  normalizePdfText,
  showPaintsVisibleGlyphs,
  tokenizeContentStream,
} from "./pdf-content-stream";
import { loadPdfDocument, PdfEncryptedMutationError } from "./pdf-io";
import { fitFontSize } from "./text-helpers";
import { canvasToJpeg } from "./image-process";
import { renderPageToImageData, looksGarbled, type TextLine } from "./pdf-runtime";
import type { OcrUncertainSnippet } from "./ocr-verify";
import { enhanceImage } from "./scan/enhance";
import { canvasFromImageData } from "./scan/image";
import { recognizePageLines, groupOcrWords } from "./scan/ocr";
import { drawOcrGlyphs } from "./scan/pdf";
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
  /** Uncertain Tesseract snippets waiting for Accept / Correct / Skip. */
  ocrVerify?: OcrUncertainSnippet[];
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
  seen: Set<string>,
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
  seen: Set<string>,
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
    // Bank statements: logo/watermark + many real operators. PDF.js groups a
    // row into one line while the stream has fragment shows, so exact
    // line===show matching fails without the page being an OCR ghost.
    // Sparse unmatched text over a page image still counts as a ghost.
    if (showCount >= 8 && pdfJsLineCount >= 8) {
      return { looksScanned: false, reason: "ok", message: "" };
    }
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
  let doc;
  try {
    doc = await loadPdfDocument(bytes);
  } catch (error) {
    if (error instanceof PdfEncryptedMutationError) {
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
    throw error;
  }
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
  const seen = new Set<string>();
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

export type ScanPaintReport = {
  showCount: number;
  visibleShowCount: number;
  invisibleShowCount: number;
  fullPageImageCount: number;
  trInsideTextObject: number;
  trOutsideTextObject: number;
  overlappingVisiblePairs: number;
  /**
   * Full-page image plus a second painted glyph layer — the Enhance export
   * failure mode (page picture already has text, OCR `drawText` paints again).
   */
  hasStackedVisibleText: boolean;
};

const IDENTITY: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

function multiplyCtm(
  a: [number, number, number, number, number, number],
  b: [number, number, number, number, number, number],
): [number, number, number, number, number, number] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function tokenNumber(
  tokens: ReturnType<typeof tokenizeContentStream>,
  index: number,
  back: number,
): number {
  let seen = 0;
  for (let i = index - 1; i >= 0; i--) {
    const token = tokens[i];
    if (!token || token.kind === "ws" || token.kind === "comment") continue;
    if (token.kind !== "num" || typeof token.value !== "number") return 0;
    seen += 1;
    if (seen === back) return token.value;
  }
  return 0;
}

function countFullPageImages(
  tokens: ReturnType<typeof tokenizeContentStream>,
  pageWidth: number,
  pageHeight: number,
): number {
  const stack: Array<[number, number, number, number, number, number]> = [];
  let ctm: [number, number, number, number, number, number] = [...IDENTITY];
  let count = 0;
  const minW = Math.max(pageWidth, 1) * 0.85;
  const minH = Math.max(pageHeight, 1) * 0.85;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.kind !== "op") continue;
    const op = String(token.value ?? token.raw);
    if (op === "q") {
      stack.push(ctm);
      continue;
    }
    if (op === "Q") {
      ctm = stack.pop() ?? [...IDENTITY];
      continue;
    }
    if (op === "cm") {
      const b: [number, number, number, number, number, number] = [
        tokenNumber(tokens, i, 6),
        tokenNumber(tokens, i, 5),
        tokenNumber(tokens, i, 4),
        tokenNumber(tokens, i, 3),
        tokenNumber(tokens, i, 2),
        tokenNumber(tokens, i, 1),
      ];
      ctm = multiplyCtm(ctm, b);
      continue;
    }
    if (op === "Do") {
      if (Math.abs(ctm[0]) >= minW && Math.abs(ctm[3]) >= minH) count += 1;
    }
  }
  return count;
}

function countTrPlacement(tokens: ReturnType<typeof tokenizeContentStream>): {
  inside: number;
  outside: number;
} {
  let inText = false;
  let inside = 0;
  let outside = 0;
  for (const token of tokens) {
    if (token.kind !== "op") continue;
    const op = String(token.value ?? token.raw);
    if (op === "BT") inText = true;
    else if (op === "ET") inText = false;
    else if (op === "Tr") {
      if (inText) inside += 1;
      else outside += 1;
    }
  }
  return { inside, outside };
}

function countOverlappingVisiblePairs(shows: ReturnType<typeof collectTextShows>): number {
  const visible = shows.filter((show) => {
    if (!showPaintsVisibleGlyphs(show)) return false;
    const text = normalizePdfText(show.text);
    if (text.length < 8) return false;
    const letters = [...text].filter((ch) => /[A-Za-z0-9]/.test(ch)).length;
    return letters / text.length >= 0.55;
  });
  let pairs = 0;
  for (let i = 0; i < visible.length; i++) {
    const a = visible[i]!;
    const aKey = normalizePdfText(a.text);
    const aW = Math.max(a.fontSize * 0.45 * Math.max(a.text.length, 1), 4);
    for (let j = i + 1; j < visible.length; j++) {
      const b = visible[j]!;
      if (Math.abs(a.y - b.y) > Math.max(2, Math.max(a.fontSize, b.fontSize) * 0.45)) continue;
      const bKey = normalizePdfText(b.text);
      const bW = Math.max(b.fontSize * 0.45 * Math.max(b.text.length, 1), 4);
      const overlap = Math.min(a.x + aW, b.x + bW) - Math.max(a.x, b.x);
      if (overlap < Math.min(aW, bW) * 0.55) continue;
      if (aKey === bKey || aKey.includes(bKey) || bKey.includes(aKey)) pairs += 1;
    }
  }
  return pairs;
}

export function inspectContentScanPaint(
  raw: Uint8Array,
  pageWidth: number,
  pageHeight: number,
): ScanPaintReport {
  const tokens = tokenizeContentStream(raw);
  const shows = collectTextShows(tokens);
  const visibleShowCount = shows.filter(showPaintsVisibleGlyphs).length;
  const tr = countTrPlacement(tokens);
  const fullPageImageCount = countFullPageImages(tokens, pageWidth, pageHeight);
  const overlappingVisiblePairs = countOverlappingVisiblePairs(shows);
  const brokenInvisibleOcr = shows.length > 0 && tr.outside > 0 && tr.inside === 0;
  return {
    showCount: shows.length,
    visibleShowCount,
    invisibleShowCount: shows.length - visibleShowCount,
    fullPageImageCount,
    trInsideTextObject: tr.inside,
    trOutsideTextObject: tr.outside,
    overlappingVisiblePairs,
    hasStackedVisibleText:
      (fullPageImageCount > 0 && brokenInvisibleOcr) || overlappingVisiblePairs > 0,
  };
}

export async function inspectPageScanPaint(
  bytes: ArrayBuffer,
  pageNumber: number,
): Promise<ScanPaintReport> {
  const doc = await loadPdfDocument(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) {
    return {
      showCount: 0,
      visibleShowCount: 0,
      invisibleShowCount: 0,
      fullPageImageCount: 0,
      trInsideTextObject: 0,
      trOutsideTextObject: 0,
      overlappingVisiblePairs: 0,
      hasStackedVisibleText: false,
    };
  }
  const { width, height } = page.getSize();
  const chunks: Uint8Array[] = [];
  for (const stream of pageContentStreams(doc, page)) {
    chunks.push(decodeStream(stream));
  }
  const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.length;
  }
  return inspectContentScanPaint(raw, width, height);
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
      originX: x,
      originY: y,
      width,
      height,
      fontSize: Math.max(4, height * 0.85),
      fontName: "OCR",
      fontFamily: "Helvetica",
      source: "ocr" as const,
      confidence: box.confidence,
      ...(box.words?.length
        ? {
            ocrWords: box.words.map((word) => ({
              text: word.text,
              confidence: word.confidence,
            })),
          }
        : {}),
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
  page.setFont(font);
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
        page.drawRectangle({
          x,
          y,
          width: boxW,
          height: boxH,
          color: rgb(1, 1, 1),
        });
        drawOcrGlyphs(page, font, text, {
          x,
          y: y + Math.max(1, (boxH - size) * 0.2),
          size,
          invisible: false,
          color: rgb(0.08, 0.08, 0.1),
        });
      } else {
        drawOcrGlyphs(page, font, text, {
          x,
          y: y + Math.max(1, (boxH - size) * 0.2),
          size,
          invisible: true,
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
  return { preset, replaceWithCleaned: false, ocrLines: [], ocrVerify: [] };
}

export function releaseScanSession(session?: ScanPageSession | null) {
  if (session?.enhancedPreviewUrl) URL.revokeObjectURL(session.enhancedPreviewUrl);
}
