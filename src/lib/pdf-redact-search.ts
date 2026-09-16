/**
 * Find and permanently redact (Acrobat redaction search lite).
 *
 * Uses pdf.js `getTextContent` to locate case-insensitive matches, then
 * turns hit boxes into `kind: "erase"` marks. Save As runs the existing
 * `applyPermanentRedaction` path so the string is not extractable.
 *
 * Cover box (`kind: "redact"`) is a visual burn only. This module never
 * emits cover-box marks and never labels a cover box as a search result.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";
import type { AnnotationBurn, AnnotationKind } from "./pdf-images";
import { estimateWidth } from "./text-helpers";

export const REDACT_SEARCH_TITLE = "Find and permanently redact";
export const COVER_BOX_LABEL = "Cover box";
export const PERMANENT_REDACT_LABEL = "permanent redact";
export const PERMANENT_REDACT_FIND_LABEL = "permanent redact · find";

export const REDACT_SEARCH_HINT =
  "Search the loaded PDF (case-insensitive). Confirming marks each hit as a permanent redaction — not a cover box. Cover boxes only hide text; they are not search results. Save As removes the text from a new copy. The file you opened is never overwritten.";

export const REDACT_SEARCH_VIEW_ONLY_HINT =
  "This file is view-only. You can search the text layer, but marking hits and Save As are blocked so the encrypted file is not damaged.";

export type PdfjsSearchItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL?: boolean;
};

export type RedactSearchRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RedactSearchHit = {
  id: string;
  page: number;
  query: string;
  matched: string;
  snippet: string;
  rects: RedactSearchRect[];
};

type Glyph = {
  ch: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const PAD = 1.6;
const DESCENT = 0.25;
const MIN_WIDTH = 4;
const MIN_HEIGHT = 10;

export function normalizeSearchQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

export function pdfjsItemsFromTextContent(
  items: Array<{
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
    hasEOL?: boolean;
  }>,
): PdfjsSearchItem[] {
  const out: PdfjsSearchItem[] = [];
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const t = item.transform ?? [];
    const height = Math.abs(t[3] ?? 0) || Math.abs(item.height ?? 0) || 10;
    // pdf.js can report a run width far narrower than the glyphs actually
    // occupy (missing/partial Widths array, or a font it maps to a default
    // glyph). For redaction an under-sized erase box leaves the tail of the
    // match extractable, so prefer the estimated width whenever the reported
    // one looks too small. Over-covering by a hair is the safe direction.
    const reported = typeof item.width === "number" && item.width > 0 ? item.width : 0;
    const estimated = estimateWidth(item.str, height);
    const width = Math.max(reported, estimated);
    out.push({
      str: item.str,
      x: t[4] ?? 0,
      y: t[5] ?? 0,
      width,
      height,
      ...(item.hasEOL ? { hasEOL: true } : {}),
    });
  }
  return out;
}

function charWidths(str: string, totalWidth: number, fontSize: number): number[] {
  const chars = [...str];
  if (!chars.length) return [];
  const weights = chars.map((ch) =>
    Math.max(0.08, estimateWidth(ch, fontSize) / Math.max(fontSize, 1)),
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(totalWidth > 0) || !(sum > 0)) {
    const fallback = Math.max(totalWidth, estimateWidth(str, fontSize), chars.length * 0.5);
    return chars.map(() => fallback / chars.length);
  }
  return weights.map((w) => (w / sum) * totalWidth);
}

function glyphsFromItems(items: PdfjsSearchItem[], page: number): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const item of items) {
    const chars = [...item.str];
    if (chars.length === 0) {
      if (item.hasEOL) glyphs.push({ ch: "\n", page, x: item.x, y: item.y, width: 0, height: 0 });
      continue;
    }
    const fontSize = Math.max(item.height, 6);
    const widths = charWidths(item.str, item.width, fontSize);
    const boxHeight = Math.max(MIN_HEIGHT, fontSize * (1 + DESCENT) + PAD);
    const boxY = item.y - DESCENT * fontSize - PAD;
    let x = item.x;
    for (let i = 0; i < chars.length; i++) {
      const width = Math.max(0.2, widths[i] ?? fontSize * 0.5);
      glyphs.push({
        ch: chars[i]!,
        page,
        x: x - PAD,
        y: boxY,
        width: width + PAD * 2,
        height: boxHeight,
      });
      x += width;
    }
    if (item.hasEOL) {
      glyphs.push({ ch: "\n", page, x, y: boxY, width: 0, height: 0 });
    }
  }
  return glyphs;
}

function unionRect(glyphs: Glyph[]): RedactSearchRect {
  const live = glyphs.filter((g) => g.width > 0 && g.height > 0);
  const box = live.length ? live : glyphs;
  const x = Math.min(...box.map((g) => g.x));
  const y = Math.min(...box.map((g) => g.y));
  const right = Math.max(...box.map((g) => g.x + g.width));
  const top = Math.max(...box.map((g) => g.y + g.height));
  return {
    x,
    y,
    width: Math.max(MIN_WIDTH, right - x),
    height: Math.max(MIN_HEIGHT, top - y),
  };
}

function clusterByBaseline(glyphs: Glyph[]): Glyph[][] {
  const visible = glyphs.filter((g) => g.ch !== "\n" && g.width > 0);
  if (!visible.length) return [];
  const sorted = [...visible].sort((a, b) => b.y - a.y || a.x - b.x);
  const bands: Glyph[][] = [];
  for (const glyph of sorted) {
    const band = bands.find(
      (row) => Math.abs((row[0]?.y ?? 0) - glyph.y) <= Math.max(3, glyph.height * 0.45),
    );
    if (band) band.push(glyph);
    else bands.push([glyph]);
  }
  return bands.map((row) => [...row].sort((a, b) => a.x - b.x));
}

function snippetAround(text: string, start: number, end: number, radius = 28): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to).replace(/\s+/g, " ").trim()}${suffix}`;
}

function indexOfAll(haystack: string, needle: string): Array<{ start: number; end: number }> {
  if (!needle) return [];
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    out.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return out;
}

/** Pure search over already-decoded pdf.js items for one page. */
export function findHitsInPageItems(
  items: PdfjsSearchItem[],
  query: string,
  page: number,
): RedactSearchHit[] {
  const needle = normalizeSearchQuery(query);
  if (!needle) return [];
  const glyphs = glyphsFromItems(items, page);
  if (!glyphs.length) return [];
  // A glyph carries one Unicode code point, but `indexOf` works in UTF-16 code
  // units and `toLowerCase()` can even change a run's length (astral emoji count
  // as two units; Turkish İ lowercases to two units). Slicing the glyph array by
  // raw string offsets therefore drifts and the erase box lands on the wrong
  // glyphs — a redaction-honesty leak that leaves the head/tail of a match
  // exposed. Build the searched string per glyph and keep unit→glyph maps so
  // every match translates back to the exact glyphs it covers.
  const chars = glyphs.map((g) => g.ch);
  let raw = "";
  let lowered = "";
  const rawStart: number[] = []; // rawStart[i] = raw offset where glyph i begins
  const lowGlyph: number[] = []; // lowGlyph[u] = glyph index owning lowered unit u
  chars.forEach((ch, i) => {
    rawStart.push(raw.length);
    raw += ch;
    const low = ch.toLowerCase();
    lowered += low;
    for (let u = 0; u < low.length; u++) lowGlyph.push(i);
  });
  rawStart.push(raw.length); // sentinel for the last glyph's end
  const ranges = indexOfAll(lowered, needle.toLowerCase());
  return ranges.flatMap((range, index) => {
    const gStart = lowGlyph[range.start] ?? 0;
    const gEnd = (lowGlyph[range.end - 1] ?? glyphs.length - 1) + 1;
    const slice = glyphs.slice(gStart, gEnd).filter((g) => g.ch !== "\n");
    if (!slice.length) return [];
    const bands = clusterByBaseline(slice);
    const rects = (bands.length ? bands : [slice]).map(unionRect);
    const rawFrom = rawStart[gStart] ?? 0;
    const rawTo = rawStart[gEnd] ?? raw.length;
    const matched = raw.slice(rawFrom, rawTo);
    return [
      {
        id: `p${page}-${gStart}-${gEnd}-${index}`,
        page,
        query: needle,
        matched,
        snippet: snippetAround(raw, rawFrom, rawTo),
        rects,
      },
    ];
  });
}

export async function searchDocumentText(
  proxy: PDFDocumentProxy,
  query: string,
): Promise<RedactSearchHit[]> {
  const needle = normalizeSearchQuery(query);
  if (!needle) return [];
  const hits: RedactSearchHit[] = [];
  for (let page = 1; page <= proxy.numPages; page++) {
    const pdfPage = await proxy.getPage(page);
    const content = await pdfPage.getTextContent({
      includeMarkedContent: false,
      disableNormalization: true,
    });
    const items = pdfjsItemsFromTextContent(
      content.items as Array<{
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
        hasEOL?: boolean;
      }>,
    );
    hits.push(...findHitsInPageItems(items, needle, page));
  }
  return hits;
}

export function isRedactSearchMark(
  mark: Pick<AnnotationBurn, "kind" | "searchQuery">,
): boolean {
  return mark.kind === "erase" && Boolean(mark.searchQuery);
}

export function markListLabel(
  mark: Pick<AnnotationBurn, "kind" | "searchQuery"> & { kind: AnnotationKind },
): string {
  if (mark.kind === "redact") return COVER_BOX_LABEL.toLowerCase();
  if (mark.kind === "erase") {
    return mark.searchQuery ? PERMANENT_REDACT_FIND_LABEL : PERMANENT_REDACT_LABEL;
  }
  if (mark.kind === "rect") return "rectangle";
  return mark.kind;
}

/**
 * Convert confirmed search hits into permanent-redact marks.
 * Always `kind: "erase"`. Never `kind: "redact"` (cover box).
 */
export function eraseMarksFromHits(hits: RedactSearchHit[]): AnnotationBurn[] {
  const marks: AnnotationBurn[] = [];
  for (const hit of hits) {
    hit.rects.forEach((rect, index) => {
      marks.push({
        id: `erase-search-${hit.id}-${index}`,
        page: hit.page,
        kind: "erase",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        searchQuery: hit.query,
      });
    });
  }
  return marks;
}
