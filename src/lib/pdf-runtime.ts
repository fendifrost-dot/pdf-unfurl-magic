/**
 * Browser-only PDF runtime. Everything here runs in the user's tab:
 * PDF.js for reading/rendering, pdf-lib for writing. No network calls.
 */
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import { installMapPolyfills } from "./map-polyfill";
import { isDesktopApp } from "./desktop";
import { saveBytes } from "./file-export";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

export async function getPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // PDF.js reaches for Map.getOrInsertComputed; older engines (Electron) lack it.
      installMapPolyfills();

      if (isDesktopApp()) {
        // Desktop runs the legacy build with a worker boot file that polyfills first.
        const legacy = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
        legacy.GlobalWorkerOptions.workerSrc = "/pdf.worker.boot.mjs";
        return legacy;
      }

      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function openDocument(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfJs();
  // Copy: PDF.js transfers/detaches the buffer it is given.
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
}

export type TextLine = {
  id: string;
  page: number;
  text: string;
  /** PDF user-space coordinates, origin bottom-left. Baseline is `y`. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  fontFamily: string;
  /** `ocr` lines come from Enhance/OCR and export as a text layer on the page image. */
  source?: "pdf" | "ocr";
  confidence?: number;
};

export type RawTextItem = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontName: string;
  fontFamily: string;
};

/**
 * Group PDF.js items into clickable runs. Items on the same baseline stay
 * together only when they share a font and the gap is word-sized — table
 * columns (amount vs label) stay separate so we rewrite one Tj, not a row.
 */
export function groupTextItems(items: RawTextItem[], pageNumber: number): TextLine[] {
  const raw = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: RawTextItem[][] = [];

  for (const item of raw) {
    const last = groups[groups.length - 1];
    const anchor = last?.[last.length - 1];
    const sameBaseline = !!anchor && Math.abs(anchor.y - item.y) <= Math.max(2, item.h * 0.35);
    const sameFont = !!anchor && anchor.fontName === item.fontName;
    const gap = anchor ? item.x - (anchor.x + anchor.w) : 0;
    const wordGap = Math.max(10, Math.max(item.h, anchor?.h ?? 0) * 1.15);
    if (last && sameBaseline && sameFont && gap >= -1 && gap <= wordGap) {
      last.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.map((group, index) => {
    group.sort((a, b) => a.x - b.x);
    const first = group[0];
    const x = Math.min(...group.map((g) => g.x));
    const right = Math.max(...group.map((g) => g.x + g.w));
    const y = Math.min(...group.map((g) => g.y));
    const fontSize = Math.max(...group.map((g) => g.h));
    let text = "";
    let cursor: number | null = null;
    for (const g of group) {
      if (cursor !== null && g.x - cursor > fontSize * 0.22 && !text.endsWith(" ")) text += " ";
      text += g.str;
      cursor = g.x + g.w;
    }
    return {
      id: `p${pageNumber}-r${index}-${Math.round(x)}-${Math.round(y)}`,
      page: pageNumber,
      text: text.replace(/\s+/g, " ").trim(),
      x,
      y,
      width: Math.max(right - x, fontSize * 0.6),
      height: fontSize * 1.18,
      fontSize,
      fontName: first?.fontName ?? "",
      fontFamily: first?.fontFamily ?? "",
    };
  });
}

/** Group PDF.js text items into visual runs with a bounding box in PDF space. */
export async function extractLines(doc: PDFDocumentProxy, pageNumber: number): Promise<TextLine[]> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const raw: RawTextItem[] = [];

  for (const item of content.items) {
    if (!("str" in item)) continue;
    const str = item.str;
    if (!str || !str.trim()) continue;
    const t = item.transform as number[];
    const height = Math.abs(t[3] ?? 0) || Math.abs(item.height) || 10;
    const fontName = "fontName" in item && typeof item.fontName === "string" ? item.fontName : "";
    const style = fontName ? content.styles[fontName] : undefined;
    raw.push({
      str,
      x: t[4] ?? 0,
      y: t[5] ?? 0,
      w: item.width || 0,
      h: height,
      fontName,
      fontFamily: style?.fontFamily ?? "",
    });
  }

  return groupTextItems(raw, pageNumber);
}

export type RenderResult = { canvas: HTMLCanvasElement; viewport: PageViewport };

export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  cssWidth: number,
): Promise<RenderResult> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  // Phones keep one page in memory; cap backing-store size so a 3x display does not 3x RAM.
  const dprCap = cssWidth < 520 ? 1.5 : 2;
  const dpr = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, dprCap);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.scale(dpr, dpr);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, viewport };
}

/**
 * Rasterize one page for scan enhance / OCR. No extra device-pixel ratio so
 * a letter page stays around one 1600px bitmap (~10 MB RGBA), then is released.
 */
export async function renderPageToImageData(
  doc: PDFDocumentProxy,
  pageNumber: number,
  maxEdge: number,
): Promise<{
  data: ImageData;
  canvas: HTMLCanvasElement;
  pageWidth: number;
  pageHeight: number;
}> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxEdge / Math.max(base.width, 1), maxEdge / Math.max(base.height, 1));
  const viewport = page.getViewport({ scale: Math.max(scale, 0.25) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return {
    data: ctx.getImageData(0, 0, canvas.width, canvas.height),
    canvas,
    pageWidth: base.width,
    pageHeight: base.height,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/pdf") {
  if (mime === "application/pdf") {
    void saveBytes(bytes, filename);
    return;
  }
  const desktop = typeof window === "undefined" ? undefined : window.pdfReliefDesktop;
  if (desktop) {
    void desktop.saveFile({ name: filename, data: new Uint8Array(bytes.slice(0)) });
    return;
  }
  const blob = new Blob([bytes.slice(0) as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function parsePageRanges(input: string, pageCount: number): number[] {
  const out: number[] = [];
  const parts = input
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to > pageCount || from > to)
        throw new Error(`Page range “${part}” is outside 1–${pageCount}.`);
      for (let p = from; p <= to; p++) out.push(p);
      continue;
    }
    const single = Number(part);
    if (!Number.isInteger(single) || single < 1 || single > pageCount) {
      throw new Error(`Page “${part}” is outside 1–${pageCount}.`);
    }
    out.push(single);
  }
  if (out.length === 0) throw new Error("Enter at least one page, like 1-3, 7.");
  return Array.from(new Set(out));
}
