/**
 * Permanent redaction: remove extractable content under a rectangle.
 *
 * Cover box (`kind: "redact"`) only paints an opaque rectangle — the operators
 * underneath stay in the file. This module is the distinct `kind: "erase"`
 * path: drop or rewrite intersecting text shows, punch simple image XObjects,
 * and strip overlapping annotations. A black appearance is then burned so the
 * hole is visible. Algorithms follow PDFBox / qpdf *ideas* (content-stream
 * walk, CTM, image XObject replace) reimplemented on pdf-lib. No AGPL.
 *
 * MVP gaps (do not claim these are handled):
 * - Form XObject text is stripped in form space only (nested paint CTM skipped).
 * - Inline BI…EI images are not punched.
 * - JPEG / DCTDecode XObjects that intersect the rect are replaced entirely.
 * - Rotated text uses axis-aligned boxes from Tf + Tm/CTM scale.
 * - Vector path operators are not erased; the black appearance covers them.
 * - CID / Type0 runs are dropped as a whole operator, not split per glyph.
 * - A shared image XObject is punched once (every placement sees the hole).
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
  rgb,
  type PDFFont,
} from "pdf-lib";
import type { AnnotationBurn } from "./pdf-images";
import {
  collectTextShows,
  removeShow,
  replaceShowText,
  tokenizeContentStream,
  tokensToBytes,
  type TextShow,
  type Token,
} from "./pdf-content-stream";
import { looksLikeUtf16Be } from "./pdf-font-match";
import {
  decodeImageXObjectRgba,
  listPageImageDraws,
  replaceImageXObjectBytes,
  type PageImageDraw,
} from "./pdf-image-xobject";
import { encodePng } from "./tiny-png";

export type RedactRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const PERMANENT_REDACT_GAPS = [
  "Form XObject text is only stripped in form space (nested paint CTM not applied).",
  "Inline BI…EI images are not punched.",
  "JPEG / DCTDecode XObjects that intersect the rect are replaced entirely, not pixel-punched.",
  "Rotated text uses axis-aligned boxes.",
  "Vector path operators are not removed; the black appearance covers them.",
  "CID / Type0 runs are dropped as a whole operator, not split per glyph.",
] as const;

const APPEARANCE = rgb(0.06, 0.06, 0.07);
const DESCENT = 0.2;

type PageStream = {
  ref: PDFRef | null;
  stream: PDFStream;
  tokens: Token[];
  dirty: boolean;
};

export function rectsOverlap(a: RedactRect, b: RedactRect, pad = 0): boolean {
  return (
    a.x - pad < b.x + b.width &&
    a.x + a.width + pad > b.x &&
    a.y - pad < b.y + b.height &&
    a.y + a.height + pad > b.y
  );
}

export function asRedactRect(
  mark: Pick<AnnotationBurn, "x" | "y" | "width" | "height">,
): RedactRect {
  return {
    x: mark.x,
    y: mark.y,
    width: Math.max(0, mark.width),
    height: Math.max(0, mark.height),
  };
}

export function markOverlapsErase(mark: AnnotationBurn, erase: AnnotationBurn[]): boolean {
  if (mark.kind === "erase") return false;
  return erase.some(
    (hole) => hole.page === mark.page && rectsOverlap(asRedactRect(mark), asRedactRect(hole)),
  );
}

export function editorMarksForSave(marks: AnnotationBurn[]): AnnotationBurn[] {
  const erase = marks.filter((m) => m.kind === "erase");
  return marks.filter(
    (m) => (m.kind === "highlight" || m.kind === "note") && !markOverlapsErase(m, erase),
  );
}

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

function pageContentStreams(doc: PDFDocument, page: PDFPage): PageStream[] {
  const contents = page.node.Contents();
  if (!contents) return [];

  const resolve = (item: unknown, ref: PDFRef | null): PageStream | null => {
    const obj = item instanceof PDFRef ? doc.context.lookup(item) : item;
    if (!(obj instanceof PDFStream)) return null;
    return {
      ref: item instanceof PDFRef ? item : ref,
      stream: obj,
      tokens: tokenizeContentStream(decodeStream(obj)),
      dirty: false,
    };
  };

  if (contents instanceof PDFArray) {
    const out: PageStream[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const raw = contents.get(i);
      const resolved = resolve(raw, raw instanceof PDFRef ? raw : null);
      if (resolved) out.push(resolved);
    }
    return out;
  }

  if (contents instanceof PDFStream) {
    const raw = page.node.get(PDFName.of("Contents"));
    return [
      {
        ref: raw instanceof PDFRef ? raw : null,
        stream: contents,
        tokens: tokenizeContentStream(decodeStream(contents)),
        dirty: false,
      },
    ];
  }

  return [];
}

function formContentStreams(doc: PDFDocument, page: PDFPage): PageStream[] {
  const resources = page.node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return [];
  const out: PageStream[] = [];
  for (const [, value] of xobjects.entries()) {
    const obj = value instanceof PDFRef ? doc.context.lookup(value) : value;
    if (!(obj instanceof PDFStream)) continue;
    const dict = (obj as PDFRawStream).dict;
    if (!dict || dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Form")) continue;
    out.push({
      ref: value instanceof PDFRef ? value : null,
      stream: obj,
      tokens: tokenizeContentStream(decodeStream(obj)),
      dirty: false,
    });
  }
  return out;
}

function writeStream(doc: PDFDocument, entry: PageStream, page: PDFPage) {
  const bytes = tokensToBytes(entry.tokens);
  const next = doc.context.flateStream(bytes);
  if (entry.ref) {
    doc.context.assign(entry.ref, next);
    return;
  }
  const registered = doc.context.register(next);
  page.node.set(PDFName.of("Contents"), registered);
}

function scaleX(show: TextShow): number {
  const tm = Math.hypot(show.textMatrix[0], show.textMatrix[1]) || 1;
  const ctm = Math.hypot(show.ctm[0], show.ctm[1]) || 1;
  return tm * ctm;
}

function scaleY(show: TextShow): number {
  const tm = Math.hypot(show.textMatrix[2], show.textMatrix[3]) || 1;
  const ctm = Math.hypot(show.ctm[2], show.ctm[3]) || 1;
  return tm * ctm;
}

export function glyphBoxesForShow(
  show: TextShow,
  widthOf: (text: string, size: number) => number,
): Array<{ ch: string; x: number; y: number; width: number; height: number }> {
  const sx = scaleX(show);
  const sy = scaleY(show);
  const height = Math.max(0.5, show.fontSize * sy);
  const y = show.y - DESCENT * height;
  const out: Array<{ ch: string; x: number; y: number; width: number; height: number }> = [];
  let x = show.x;
  for (const ch of show.text) {
    const width = Math.max(0.2, widthOf(ch, show.fontSize) * sx);
    out.push({ ch, x, y, width, height });
    x += width;
  }
  return out;
}

export function keptTextForShow(
  show: TextShow,
  holes: RedactRect[],
  widthOf: (text: string, size: number) => number,
): { kept: string; hit: boolean } {
  if (!show.text) return { kept: "", hit: false };
  const boxes = glyphBoxesForShow(show, widthOf);
  if (boxes.length === 0) {
    const fallback: RedactRect = {
      x: show.x,
      y: show.y - DESCENT * show.fontSize,
      width: Math.max(show.fontSize, widthOf(show.text, show.fontSize) * scaleX(show)),
      height: show.fontSize * scaleY(show),
    };
    const hit = holes.some((hole) => rectsOverlap(fallback, hole, 0.5));
    return { kept: hit ? "" : show.text, hit };
  }
  let kept = "";
  let hit = false;
  for (const glyph of boxes) {
    if (holes.some((hole) => rectsOverlap(glyph, hole, 0.35))) {
      hit = true;
      continue;
    }
    kept += glyph.ch;
  }
  return { kept, hit };
}

function canRewriteShow(show: TextShow): boolean {
  if (looksLikeUtf16Be(show.bytes)) return false;
  return true;
}

function stripShowsOnStream(
  stream: PageStream,
  holes: RedactRect[],
  widthOf: (text: string, size: number) => number,
) {
  const shows = collectTextShows(stream.tokens);
  const hits = shows
    .map((show) => ({ show, ...keptTextForShow(show, holes, widthOf) }))
    .filter((item) => item.hit)
    .sort((a, b) => b.show.start - a.show.start);
  for (const item of hits) {
    const remaining = item.kept.replace(/\s+/g, " ").trim() ? item.kept : "";
    if (!remaining) {
      stream.tokens = removeShow(stream.tokens, item.show);
      stream.dirty = true;
      continue;
    }
    if (remaining === item.show.text) continue;
    if (!canRewriteShow(item.show)) {
      stream.tokens = removeShow(stream.tokens, item.show);
      stream.dirty = true;
      continue;
    }
    stream.tokens = replaceShowText(stream.tokens, item.show, remaining);
    stream.dirty = true;
  }
}

function asNumber(obj: unknown): number {
  if (typeof obj === "number") return obj;
  if (obj instanceof PDFNumber) return obj.asNumber();
  return 0;
}

function annotRect(dict: PDFDict): RedactRect | null {
  const raw = dict.lookup(PDFName.of("Rect"));
  if (raw instanceof PDFArray && raw.size() >= 4) {
    try {
      return raw.asRectangle();
    } catch {
      const x1 = asNumber(raw.get(0));
      const y1 = asNumber(raw.get(1));
      const x2 = asNumber(raw.get(2));
      const y2 = asNumber(raw.get(3));
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    }
  }
  return null;
}

function removeOverlappingAnnots(doc: PDFDocument, page: PDFPage, holes: RedactRect[]) {
  const annots = page.node.Annots();
  if (!annots) return;
  for (let i = annots.size() - 1; i >= 0; i--) {
    const item = annots.get(i);
    const dict = doc.context.lookup(item);
    if (!(dict instanceof PDFDict)) continue;
    const rect = annotRect(dict);
    const overlaps = rect ? holes.some((hole) => rectsOverlap(rect, hole, 0.5)) : false;
    if (!overlaps) continue;
    annots.remove(i);
  }
}

function intersection(a: RedactRect, b: RedactRect): RedactRect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 - x1 <= 0.01 || y2 - y1 <= 0.01) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function pageBoxToPixelBox(draw: PageImageDraw, hole: RedactRect): RedactRect | null {
  const drawBox: RedactRect = {
    x: draw.x,
    y: draw.y,
    width: draw.widthPt,
    height: draw.heightPt,
  };
  const hit = intersection(drawBox, hole);
  if (!hit) return null;
  const wPt = Math.max(draw.widthPt, 1e-6);
  const hPt = Math.max(draw.heightPt, 1e-6);
  const u0 = (hit.x - draw.x) / wPt;
  const u1 = (hit.x + hit.width - draw.x) / wPt;
  const v0 = (hit.y - draw.y) / hPt;
  const v1 = (hit.y + hit.height - draw.y) / hPt;
  const px0 = Math.max(0, Math.min(draw.width, Math.floor(u0 * draw.width)));
  const px1 = Math.max(0, Math.min(draw.width, Math.ceil(u1 * draw.width)));
  const py0 = Math.max(0, Math.min(draw.height, Math.floor((1 - v1) * draw.height)));
  const py1 = Math.max(0, Math.min(draw.height, Math.ceil((1 - v0) * draw.height)));
  if (px1 <= px0 || py1 <= py0) return null;
  return { x: px0, y: py0, width: px1 - px0, height: py1 - py0 };
}

function punchRgba(rgba: Uint8Array, width: number, height: number, region: RedactRect) {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.width));
  const y1 = Math.min(height, Math.ceil(region.y + region.height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 255;
    }
  }
}

function blackPng(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(Math.max(1, width) * Math.max(1, height) * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return encodePng(Math.max(1, width), Math.max(1, height), rgba);
}

async function punchImagesOnPage(doc: PDFDocument, page: PDFPage, holes: RedactRect[]) {
  const draws = listPageImageDraws(doc, page);
  const byRef = new Map<
    number,
    { ref: PageImageDraw["ref"]; width: number; height: number; regions: RedactRect[] }
  >();
  for (const draw of draws) {
    const regions: RedactRect[] = [];
    for (const hole of holes) {
      const pixel = pageBoxToPixelBox(draw, hole);
      if (pixel) regions.push(pixel);
    }
    if (!regions.length) continue;
    const current = byRef.get(draw.ref.objectNumber);
    if (current) {
      current.regions.push(...regions);
      continue;
    }
    byRef.set(draw.ref.objectNumber, {
      ref: draw.ref,
      width: draw.width,
      height: draw.height,
      regions,
    });
  }

  for (const entry of byRef.values()) {
    const decoded = decodeImageXObjectRgba(doc, entry.ref);
    if (!decoded) {
      await replaceImageXObjectBytes(doc, entry.ref, blackPng(entry.width, entry.height));
      continue;
    }
    for (const region of entry.regions)
      punchRgba(decoded.rgba, decoded.width, decoded.height, region);
    await replaceImageXObjectBytes(
      doc,
      entry.ref,
      encodePng(decoded.width, decoded.height, decoded.rgba),
    );
  }
}

function paintEraseAppearance(page: PDFPage, holes: RedactRect[]) {
  const { width: pw, height: ph } = page.getSize();
  for (const hole of holes) {
    const x = Math.max(0, Math.min(hole.x, pw));
    const y = Math.max(0, Math.min(hole.y, ph));
    const width = Math.max(1, Math.min(hole.width, pw - x));
    const height = Math.max(1, Math.min(hole.height, ph - y));
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: APPEARANCE,
      opacity: 1,
    });
  }
}

function widthFn(font: PDFFont) {
  return (text: string, size: number) => {
    if (!text) return 0;
    try {
      return font.widthOfTextAtSize(text, size);
    } catch {
      return text.length * size * 0.5;
    }
  };
}

/**
 * Erase extractable text / image pixels under `kind: "erase"` rectangles.
 * Cover box marks are ignored here.
 */
export async function applyPermanentRedaction(doc: PDFDocument, marks: AnnotationBurn[]) {
  const erase = marks.filter((m) => m.kind === "erase");
  if (!erase.length) return;

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const measure = widthFn(helv);
  const pages = doc.getPages();
  const byPage = new Map<number, RedactRect[]>();
  for (const mark of erase) {
    const list = byPage.get(mark.page) ?? [];
    list.push(asRedactRect(mark));
    byPage.set(mark.page, list);
  }

  for (const [pageNumber, holes] of byPage) {
    const page = pages[pageNumber - 1];
    if (!page) continue;
    const streams = [...pageContentStreams(doc, page), ...formContentStreams(doc, page)];
    for (const stream of streams) {
      stripShowsOnStream(stream, holes, measure);
      if (stream.dirty) writeStream(doc, stream, page);
    }
    await punchImagesOnPage(doc, page, holes);
    removeOverlappingAnnots(doc, page, holes);
    paintEraseAppearance(page, holes);
  }
}
