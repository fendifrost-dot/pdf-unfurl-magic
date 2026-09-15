/**
 * Browser-only PDF runtime. Everything here runs in the user's tab:
 * PDF.js for reading/rendering, pdf-lib for writing. No network calls.
 */
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import { installMapPolyfills } from "./map-polyfill";
import { isDesktopApp } from "./desktop";
import { saveBytes } from "./file-export";
import { listPageTextShows } from "./pdf-text-edit";

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
  /** `ocr` lines come from Enhance/OCR. Content-stream vs PDF.js is for native text. */
  source?: "pdf" | "ocr" | "content-stream" | "pdfjs";
  confidence?: number;
  hasTextOperator?: boolean;
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

const PUNCT_ONLY = /^[\s,.;:!?%'"“”‘’()[\]{}\-/–—−$€£¥]+$/;
const LEADING_PUNCT = /^[,.;:!?%'"”’)\]}-]/;
const TRAILING_MONEY = /[,$€£¥.\-–—−]$/;

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
    const glue =
      !!anchor &&
      (PUNCT_ONLY.test(item.str) ||
        PUNCT_ONLY.test(anchor.str) ||
        (TRAILING_MONEY.test(anchor.str) && /^\d/.test(item.str)));
    const wordGap = Math.max(10, Math.max(item.h, anchor?.h ?? 0) * 1.15);
    if (last && sameBaseline && sameFont && gap >= -1 && (gap <= wordGap || glue)) {
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
      if (cursor !== null && !text.endsWith(" ") && !text.endsWith(",")) {
        const recovered = recoverThousandsComma(text, g, cursor, fontSize);
        if (recovered) text += recovered;
        else if (shouldInsertJoinSpace(text, g, cursor, fontSize)) text += " ";
      }
      text += g.str;
      cursor = g.x + g.w;
    }
    return {
      id: `p${pageNumber}-r${index}-${Math.round(x)}-${Math.round(y)}`,
      page: pageNumber,
      text: text.replace(/[ \t]+/g, " ").trim(),
      x,
      y,
      width: Math.max(right - x, fontSize * 0.6),
      height: fontSize * 1.18,
      fontSize,
      fontName: first?.fontName ?? "",
      fontFamily: first?.fontFamily ?? "",
      source: "pdfjs",
      hasTextOperator: true,
    };
  });
}

function recoverThousandsComma(
  prevText: string,
  next: RawTextItem,
  cursor: number,
  fontSize: number,
): "," | "" {
  if (!/\d$/.test(prevText) || !/^\d{3}(?:\D|$)/.test(next.str)) return "";
  if (prevText.endsWith(",") || next.str.startsWith(",")) return "";
  const gap = next.x - cursor;
  if (gap < -1 || gap > fontSize * 0.55) return "";
  return ",";
}

function shouldInsertJoinSpace(
  prevText: string,
  next: RawTextItem,
  cursor: number,
  fontSize: number,
): boolean {
  if (LEADING_PUNCT.test(next.str)) return false;
  if (TRAILING_MONEY.test(prevText) && /^\d/.test(next.str)) return false;
  if (PUNCT_ONLY.test(next.str) && next.str.trim() !== "") return false;
  return next.x - cursor > fontSize * 0.22;
}

function collectPdfjsItems(
  items: Array<{
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
    fontName?: string;
  }>,
  styles: Record<string, { fontFamily?: string } | undefined>,
): RawTextItem[] {
  const raw: RawTextItem[] = [];
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const str = item.str;
    // Keep punctuation-only runs (comma, period, currency). Skip blank items.
    if (!str) continue;
    if (!str.trim() && !PUNCT_ONLY.test(str)) continue;
    const t = item.transform ?? [];
    const height = Math.abs(t[3] ?? 0) || Math.abs(item.height ?? 0) || 10;
    const fontName = typeof item.fontName === "string" ? item.fontName : "";
    const style = fontName ? styles[fontName] : undefined;
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
  return raw;
}

/**
 * Group PDF.js text items into visual runs with a bounding box in PDF space.
 * When `sourceBytes` is provided, content-stream shows win: one Tj/TJ = one
 * clickable run, with commas taken from the stream rather than PDF.js.
 */
export async function extractLines(
  doc: PDFDocumentProxy,
  pageNumber: number,
  sourceBytes?: ArrayBuffer,
): Promise<TextLine[]> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const raw = collectPdfjsItems(
    content.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
      fontName?: string;
    }>,
    content.styles as Record<string, { fontFamily?: string } | undefined>,
  );
  const pdfjsLines = groupTextItems(raw, pageNumber);

  if (!sourceBytes) return pdfjsLines;

  try {
    const shows = await listPageTextShows(sourceBytes, pageNumber);
    if (shows.length === 0) return [];
    return shows.map((show, index) => {
      const fontSize = show.fontSize || 10;
      const estimatedWidth = Math.max(fontSize * 0.6, show.text.length * fontSize * 0.52);
      const mapped = raw.filter((item) => {
        if (Math.abs(item.y - show.y) > Math.max(3, fontSize * 0.4)) return false;
        const itemRight = item.x + item.w;
        const showRight = show.x + estimatedWidth;
        const overlap = Math.min(itemRight, showRight) - Math.max(item.x, show.x);
        return overlap > Math.min(item.w, estimatedWidth) * 0.35;
      });
      const x = mapped.length ? Math.min(...mapped.map((g) => g.x), show.x) : show.x;
      const right = mapped.length
        ? Math.max(...mapped.map((g) => g.x + g.w), show.x + estimatedWidth * 0.5)
        : show.x + estimatedWidth;
      const pdfjsHint = mapped[0];
      return {
        id: `p${pageNumber}-s${index}-${Math.round(show.x)}-${Math.round(show.y)}`,
        page: pageNumber,
        text: show.text,
        x,
        y: show.y,
        width: Math.max(right - x, fontSize * 0.6),
        height: fontSize * 1.18,
        fontSize,
        fontName: show.fontName || pdfjsHint?.fontName || "",
        fontFamily: pdfjsHint?.fontFamily || "",
        source: "content-stream" as const,
        hasTextOperator: true,
      };
    });
  } catch (error) {
    console.error("content-stream text extract failed; using PDF.js runs", error);
    return pdfjsLines;
  }
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
