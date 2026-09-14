/**
 * Browser-only PDF runtime. Everything here runs in the user's tab:
 * PDF.js for reading/rendering, pdf-lib for writing. No network calls.
 */
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

export async function getPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
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
  /** PDF user-space coordinates, origin bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

/** Group PDF.js text items into visual lines with a bounding box in PDF space. */
export async function extractLines(doc: PDFDocumentProxy, pageNumber: number): Promise<TextLine[]> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();

  type Raw = { str: string; x: number; y: number; w: number; h: number };
  const raw: Raw[] = [];

  for (const item of content.items) {
    if (!("str" in item)) continue;
    const str = item.str;
    if (!str || !str.trim()) continue;
    const t = item.transform as number[];
    const height = Math.abs(t[3] ?? 0) || Math.abs(item.height) || 10;
    raw.push({ str, x: t[4] ?? 0, y: t[5] ?? 0, w: item.width || 0, h: height });
  }

  raw.sort((a, b) => b.y - a.y || a.x - b.x);

  const groups: Raw[][] = [];
  for (const item of raw) {
    const last = groups[groups.length - 1];
    const anchor = last?.[0];
    if (last && anchor && Math.abs(anchor.y - item.y) <= Math.max(2, item.h * 0.4)) {
      last.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.map((group, index) => {
    group.sort((a, b) => a.x - b.x);
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
      id: `p${pageNumber}-l${index}`,
      page: pageNumber,
      text: text.replace(/\s+/g, " ").trim(),
      x,
      y,
      width: Math.max(right - x, fontSize * 0.6),
      height: fontSize * 1.18,
      fontSize,
    };
  });
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
  const dpr = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2);
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.slice(0) as unknown as BlobPart], { type: "application/pdf" });
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
      if (from < 1 || to > pageCount || from > to) throw new Error(`Page range “${part}” is outside 1–${pageCount}.`);
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
