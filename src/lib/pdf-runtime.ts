/**
 * Browser-only PDF runtime. Everything here runs in the user's tab:
 * PDF.js for reading/rendering, pdf-lib for writing. No network calls.
 */
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import { installMapPolyfills } from "./map-polyfill";
import { isDesktopApp } from "./desktop";
import { saveBytes } from "./file-export";
import { listPageTextShows } from "./pdf-text-edit";
import { sameVisibleRun } from "./pdf-content-stream";

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
  /** Unicode / visual string the user reads — never raw CID bytes. */
  text: string;
  /**
   * Content-stream decode when it differs from `text` (custom / CID encodings).
   * Used only to locate Tj operators; never shown in the textarea.
   */
  rawText?: string;
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
  /** `line` is a merged visual row; `run` is a tighter fragment (shift-click). */
  kind?: "run" | "line";
  members?: TextLine[];
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
    const sameBaseline =
      !!anchor && Math.abs(anchor.y - item.y) <= Math.max(3, Math.max(item.h, anchor.h) * 0.45);
    const sameFont = !!anchor && anchor.fontName === item.fontName;
    const gap = anchor ? item.x - (anchor.x + anchor.w) : 0;
    const glue =
      !!anchor &&
      (PUNCT_ONLY.test(item.str) ||
        PUNCT_ONLY.test(anchor.str) ||
        (TRAILING_MONEY.test(anchor.str) && /^\d/.test(item.str)));
    const wordGap = Math.max(10, Math.max(item.h, anchor?.h ?? 0) * 1.65);
    const overlapOk = gap >= -Math.max(1, Math.max(item.h, anchor?.h ?? 0) * 0.65);
    if (last && sameBaseline && sameFont && overlapOk && (gap <= wordGap || glue)) {
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
      kind: "run",
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

/**
 * Content-stream bytes decoded as WinAnsi/latin1 for a custom or CID font
 * look like this — not like the ToUnicode string PDF.js paints.
 */
export function looksGarbled(text: string): boolean {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return true;
  const chars = [...s];
  if ((s.match(/\\/g) || []).length >= 2) return true;
  if (/\\[A-Za-z]/.test(s)) return true;
  const printable = chars.filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return (cp >= 0x20 && cp <= 0x7e) || cp === 0x09 || cp >= 0xa0;
  }).length;
  return printable / chars.length < 0.8;
}

/**
 * UI / textarea value: PDF.js ToUnicode when the stream decode is mojibake
 * or a different encoding. Prefer the stream only when both strings are the
 * same visible run (so thousands commas survive).
 */
export function preferReadableText(streamText: string, visualText: string): string {
  const stream = streamText.replace(/[ \t]+/g, " ").trim();
  const visual = visualText.replace(/[ \t]+/g, " ").trim();
  if (!visual) return stream;
  if (!stream) return visual;
  if (stream === visual) return stream;
  const streamBad = looksGarbled(stream);
  const visualBad = looksGarbled(visual);
  if (streamBad && !visualBad) return visual;
  if (!streamBad && visualBad) return stream;
  if (!streamBad && !visualBad && sameVisibleRun(stream, visual)) {
    if (/[,$€£¥]/.test(stream) && !/[,$€£¥]/.test(visual)) return stream;
    return stream.length >= visual.length ? stream : visual;
  }
  return visualBad ? stream : visual;
}

const COLUMN_EM = 3.2;

function joinRunGap(prev: TextLine, next: TextLine, prevText: string, fontSize: number): string {
  const fake: RawTextItem = {
    str: next.text,
    x: next.x,
    y: next.y,
    w: next.width,
    h: next.fontSize,
    fontName: next.fontName,
    fontFamily: next.fontFamily,
  };
  const recovered = recoverThousandsComma(prevText, fake, prev.x + prev.width, fontSize);
  if (recovered) return recovered;
  if (shouldInsertJoinSpace(prevText, fake, prev.x + prev.width, fontSize)) return " ";
  // PDF.js sometimes over-reports width so a far amount looks like it abuts
  // the label. Still insert a space between two word-sized runs.
  if (
    prev.text.trim().length >= 3 &&
    next.text.trim().length >= 3 &&
    !prevText.endsWith(" ") &&
    !LEADING_PUNCT.test(next.text) &&
    !(TRAILING_MONEY.test(prevText) && /^\d/.test(next.text))
  ) {
    return " ";
  }
  return "";
}

export function joinRunsToLine(runs: TextLine[]): TextLine {
  const sorted = [...runs].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  if (!first) {
    return {
      id: "empty",
      page: 1,
      text: "",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      fontSize: 10,
      fontName: "",
      fontFamily: "",
      kind: "line",
      members: [],
    };
  }
  if (sorted.length === 1) {
    return { ...first, kind: "line", members: first.members ?? [first] };
  }
  const x = Math.min(...sorted.map((r) => r.x));
  const right = Math.max(...sorted.map((r) => r.x + r.width));
  const y = Math.min(...sorted.map((r) => r.y));
  const fontSize = Math.max(...sorted.map((r) => r.fontSize));
  let text = "";
  const rawParts: string[] = [];
  let prev: TextLine | null = null;
  for (const run of sorted) {
    if (prev) text += joinRunGap(prev, run, text, fontSize);
    text += run.text;
    rawParts.push(run.rawText ?? run.text);
    prev = run;
  }
  const display = text.replace(/[ \t]+/g, " ").trim();
  const rawJoined = rawParts
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
  return {
    id: `p${first.page}-l${Math.round(x)}-${Math.round(y)}`,
    page: first.page,
    text: display,
    ...(rawJoined && rawJoined !== display ? { rawText: rawJoined } : {}),
    x,
    y,
    width: Math.max(right - x, fontSize * 0.6),
    height: fontSize * 1.18,
    fontSize,
    fontName: first.fontName,
    fontFamily: first.fontFamily,
    source: first.source,
    hasTextOperator: sorted.some((r) => r.hasTextOperator !== false),
    kind: "line",
    members: sorted.flatMap((run) => (run.members?.length ? run.members : [run])),
  };
}

/**
 * Merge adjacent runs on one baseline into a clickable row. A large gutter
 * (amount column) stays a separate box so a total can still be edited alone.
 * Use `expandToFullLine` to include those columns.
 */
export function mergeLinesByBaseline(runs: TextLine[]): TextLine[] {
  if (runs.length === 0) return [];
  if (runs.length === 1) return [joinRunsToLine(runs)];
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const bands: TextLine[][] = [];
  for (const run of sorted) {
    const band = bands[bands.length - 1];
    const anchor = band?.[0];
    const yTol = Math.max(3, Math.max(run.fontSize, anchor?.fontSize ?? run.fontSize) * 0.5);
    if (band && anchor && Math.abs(anchor.y - run.y) <= yTol) band.push(run);
    else bands.push([run]);
  }
  const out: TextLine[] = [];
  for (const band of bands) {
    band.sort((a, b) => a.x - b.x);
    let current: TextLine[] = [];
    for (const run of band) {
      const prev = current[current.length - 1];
      if (!prev) {
        current = [run];
        continue;
      }
      const gap = run.x - (prev.x + prev.width);
      const em = Math.max(run.fontSize, prev.fontSize, 8);
      const columnGap = Math.max(COLUMN_EM * em, 36);
      if (gap > columnGap) {
        out.push(joinRunsToLine(current));
        current = [run];
      } else {
        current.push(run);
      }
    }
    if (current.length) out.push(joinRunsToLine(current));
  }
  return out;
}

/** Join every run on the selected baseline, including a far-right amount column. */
export function expandToFullLine(lines: TextLine[], selected: TextLine): TextLine | null {
  const band = Math.max(3, selected.fontSize * 0.5);
  const mates = lines.filter(
    (line) => line.page === selected.page && Math.abs(line.y - selected.y) <= band,
  );
  const runs = mates.flatMap((line) => (line.members?.length ? line.members : [line]));
  if (runs.length === 0) return null;
  const joined = joinRunsToLine(runs);
  if (joined.text === selected.text && Math.abs(joined.width - selected.width) < 1) return null;
  return joined;
}

function attachStreamHints(
  run: TextLine,
  shows: Array<{ text: string; x: number; y: number; fontSize: number }>,
): TextLine {
  const band = Math.max(3, run.fontSize * 0.5);
  const hits = shows.filter((show) => {
    if (Math.abs(show.y - run.y) > band) return false;
    const showW = Math.max(show.fontSize * 0.6, show.text.length * show.fontSize * 0.5);
    const overlap = Math.min(show.x + showW, run.x + run.width) - Math.max(show.x, run.x);
    return overlap > Math.min(showW, run.width) * 0.25;
  });
  if (hits.length === 0) return run;
  const streamText = hits
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((show) => show.text)
    .join("");
  const display = preferReadableText(streamText, run.text);
  return {
    ...run,
    text: display,
    ...(streamText && streamText !== display ? { rawText: streamText } : {}),
    source: "content-stream",
    hasTextOperator: true,
  };
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
 * Group PDF.js text items into visual lines with a bounding box in PDF space.
 * `item.str` from getTextContent (ToUnicode) is the textarea value. Content-
 * stream bytes are attached as `rawText` when they differ so rewrite can
 * still find the Tj; they are never shown as the primary edit string.
 */
export async function extractLines(
  doc: PDFDocumentProxy,
  pageNumber: number,
  sourceBytes?: ArrayBuffer,
): Promise<TextLine[]> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent({
    includeMarkedContent: false,
    disableNormalization: true,
  });
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
  const pdfjsRuns = groupTextItems(raw, pageNumber);

  if (!sourceBytes) return mergeLinesByBaseline(pdfjsRuns);

  try {
    const shows = await listPageTextShows(sourceBytes, pageNumber);
    if (shows.length === 0) return [];
    const hinted = pdfjsRuns.map((run) => attachStreamHints(run, shows));
    return mergeLinesByBaseline(hinted);
  } catch (error) {
    console.error("content-stream text extract failed; using PDF.js runs", error);
    return mergeLinesByBaseline(pdfjsRuns);
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
