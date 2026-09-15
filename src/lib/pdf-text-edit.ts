/**
 * Safe PDF text replace.
 *
 * Acrobat TouchUp_TextEdit (and the previous PDF Relief exporter) hid the
 * original glyphs under a white rectangle and drew a new Helvetica run on
 * top. That duplicates the text object, shifts baselines, eats neighbouring
 * rules, and is exactly the corruption we refuse to write.
 *
 * This pipeline:
 *  1. Finds the matching Tj / TJ on the edited page's content stream.
 *  2. Rewrites that string (and Tf size if the copy no longer fits).
 *  3. Only if the original font cannot encode the new characters, removes
 *     the old show and appends a Standard 14 stand-in — never a cover rect.
 *  4. Leaves every other page's content stream untouched.
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
  type PDFFont,
} from "pdf-lib";
import {
  collectTextShows,
  encodePdfLiteral,
  extractShownStrings,
  hasWhiteCoverRect,
  normalizePdfText,
  removeShow,
  replaceShowText,
  tokenizeContentStream,
  tokensToBytes,
  type TextShow,
  type Token,
} from "./pdf-content-stream";
import {
  charsMissingFromWinAnsi,
  describeFontMatch,
  isExactStandardBaseFont,
  matchFont,
  type FontMatch,
} from "./pdf-font-match";
import { fitFontSize } from "./text-helpers";

export type TextPatch = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  text: string;
  originalText?: string;
  fontName?: string;
  fontFamily?: string;
};

export type TextEditMethod = "in-place" | "redraw-standard" | "blocked";

export type TextEditReport = {
  page: number;
  originalText: string;
  text: string;
  method: TextEditMethod;
  fontMatch: FontMatch;
  fontLabel: string;
  missingGlyphs: string[];
  found: boolean;
  warning?: string;
};

export type TextEditInspection = {
  found: boolean;
  method: TextEditMethod;
  fontMatch: FontMatch;
  fontLabel: string;
  missingGlyphs: string[];
  baseFont?: string;
  message: string;
};

type PageStream = {
  ref: PDFRef | null;
  stream: PDFStream;
  tokens: Token[];
  dirty: boolean;
};

function loadDoc(bytes: ArrayBuffer) {
  return PDFDocument.load(bytes.slice(0), { ignoreEncryption: true, updateMetadata: false });
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

type FontInfo = {
  key: string;
  baseFont: string;
  encoding: string;
  subset: boolean;
  standard: boolean;
};

function readPageFonts(page: PDFPage): Map<string, FontInfo> {
  const map = new Map<string, FontInfo>();
  const resources = page.node.Resources();
  const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fonts) return map;
  for (const [name, value] of fonts.entries()) {
    const dict = page.doc.context.lookup(value);
    if (!(dict instanceof PDFDict)) continue;
    const base = dict.lookupMaybe(PDFName.of("BaseFont"), PDFName);
    const encoding = dict.lookupMaybe(PDFName.of("Encoding"), PDFName);
    const baseFont = base?.decodeText() ?? "";
    const encodingName = encoding?.decodeText() ?? "";
    map.set(name.decodeText(), {
      key: name.decodeText(),
      baseFont,
      encoding: encodingName,
      subset: /^[A-Z]{6}\+/.test(baseFont),
      standard: isExactStandardBaseFont(baseFont),
    });
  }
  return map;
}

function scoreShow(show: TextShow, patch: TextPatch, original: string): number | null {
  if (normalizePdfText(show.text) !== normalizePdfText(original)) return null;
  const dx = show.x - patch.x;
  const dy = show.y - patch.y;
  const dist = Math.hypot(dx, dy);
  return 1000 - dist;
}

function findShow(
  streams: PageStream[],
  patch: TextPatch,
  original: string,
): { stream: PageStream; show: TextShow } | null {
  let best: { stream: PageStream; show: TextShow; score: number } | null = null;
  for (const stream of streams) {
    for (const show of collectTextShows(stream.tokens)) {
      const score = scoreShow(show, patch, original);
      if (score === null) continue;
      if (!best || score > best.score) best = { stream, show, score };
    }
  }
  return best;
}

function canReuseEmbeddedFont(info: FontInfo | undefined, original: string, next: string): boolean {
  if (!info) return false;
  if (info.subset) {
    const originalSet = new Set(original);
    return [...next].every((ch) => ch === " " || originalSet.has(ch));
  }
  if (info.standard) return charsMissingFromWinAnsi(next).length === 0;
  if (/winansi/i.test(info.encoding)) return charsMissingFromWinAnsi(next).length === 0;
  return false;
}

function shrinkSize(text: string, originalSize: number, width: number, font?: PDFFont): number {
  let size = fitFontSize(text, originalSize, width);
  if (!font) return size;
  while (size > 4 && font.widthOfTextAtSize(text, size) > width) size -= 0.25;
  return Math.max(size, 4);
}

function updateTfSize(tokens: Token[], show: TextShow, size: number) {
  for (let i = show.start; i >= 0; i--) {
    const token = tokens[i];
    if (token?.kind === "op" && token.value === "BT") break;
    if (token?.kind === "op" && token.value === "Tf") {
      for (let k = i - 1; k >= 0; k--) {
        const prev = tokens[k];
        if (!prev || prev.kind === "ws" || prev.kind === "comment") continue;
        if (prev.kind === "num") {
          const next = size.toFixed(2).replace(/\.00$/, "");
          tokens[k] = { kind: "num", raw: next, value: size };
        }
        break;
      }
      return;
    }
  }
}

function uniqueFontKey(fonts: PDFDict): string {
  let i = 1;
  while (fonts.has(PDFName.of(`PRF${i}`))) i += 1;
  return `PRF${i}`;
}

function ensurePageFont(page: PDFPage, font: PDFFont): string {
  const resources = page.node.Resources();
  if (!resources) {
    const created = page.doc.context.obj({ Font: { [font.name]: font.ref } });
    page.node.set(PDFName.of("Resources"), created);
    return font.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "PRF1";
  }
  let fontDict = resources.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fontDict) {
    fontDict = page.doc.context.obj({});
    resources.set(PDFName.of("Font"), fontDict);
  }
  for (const [name, value] of fontDict.entries()) {
    if (value === font.ref) return name.decodeText();
    if (value instanceof PDFRef && value.tag === font.ref.tag) return name.decodeText();
  }
  const key = uniqueFontKey(fontDict);
  fontDict.set(PDFName.of(key), font.ref);
  return key;
}

function appendRedraw(
  stream: PageStream,
  patch: TextPatch,
  show: TextShow,
  fontKey: string,
  size: number,
) {
  const color = show.fill;
  const text = patch.text.replace(/\s*\n\s*/g, " ");
  const encoded = encodePdfLiteral(text);
  const x = show.x;
  const y = show.y;
  const snippet = [
    { kind: "ws" as const, raw: "\n" },
    { kind: "op" as const, raw: "BT", value: "BT" },
    { kind: "ws" as const, raw: "\n" },
    { kind: "name" as const, raw: `/${fontKey}`, value: fontKey },
    { kind: "ws" as const, raw: " " },
    { kind: "num" as const, raw: size.toFixed(2).replace(/\.00$/, ""), value: size },
    { kind: "ws" as const, raw: " " },
    { kind: "op" as const, raw: "Tf", value: "Tf" },
    { kind: "ws" as const, raw: "\n" },
    { kind: "num" as const, raw: String(color.r), value: color.r },
    { kind: "ws" as const, raw: " " },
    { kind: "num" as const, raw: String(color.g), value: color.g },
    { kind: "ws" as const, raw: " " },
    { kind: "num" as const, raw: String(color.b), value: color.b },
    { kind: "ws" as const, raw: " " },
    { kind: "op" as const, raw: "rg", value: "rg" },
    { kind: "ws" as const, raw: "\n" },
    { kind: "num" as const, raw: "1", value: 1 },
    { kind: "ws" as const, raw: " " },
    { kind: "num" as const, raw: "0", value: 0 },
    { kind: "ws" as const, raw: " " },
    { kind: "num" as const, raw: "0", value: 0 },
    { kind: "ws" as const, raw: " " },
    { kind: "num" as const, raw: "1", value: 1 },
    { kind: "ws" as const, raw: " " },
    { kind: "num" as const, raw: trimNum(x), value: x },
    { kind: "ws" as const, raw: " " },
    { kind: "num" as const, raw: trimNum(y), value: y },
    { kind: "ws" as const, raw: " " },
    { kind: "op" as const, raw: "Tm", value: "Tm" },
    { kind: "ws" as const, raw: "\n" },
    encoded,
    { kind: "ws" as const, raw: " " },
    { kind: "op" as const, raw: "Tj", value: "Tj" },
    { kind: "ws" as const, raw: "\n" },
    { kind: "op" as const, raw: "ET", value: "ET" },
    { kind: "ws" as const, raw: "\n" },
  ];
  stream.tokens.push(...snippet);
}

function trimNum(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function buildInspection(
  found: boolean,
  match: FontMatch,
  missingGlyphs: string[],
  reuse: boolean,
  baseFont?: string,
): TextEditInspection {
  let method: TextEditMethod = "blocked";
  if (missingGlyphs.length > 0 || match.kind === "unsafe") method = "blocked";
  else if (found && reuse) method = "in-place";
  else if (found) method = "redraw-standard";
  else method = "blocked";

  const fontLabel = baseFont || match.label;
  const message =
    method === "blocked" && !found
      ? "This run was not found as a text operator on the page. Export will refuse rather than paint over it."
      : describeFontMatch(match, missingGlyphs);

  return {
    found,
    method,
    fontMatch: match,
    fontLabel,
    missingGlyphs,
    ...(baseFont ? { baseFont } : {}),
    message,
  };
}

export function canCommitSafely(
  inspection: TextEditInspection | null,
  draft: string,
  original: string,
): boolean {
  if (!draft.trim() || draft.trim() === original) return true;
  if (!inspection) return true;
  if (inspection.missingGlyphs.length > 0) return false;
  if (inspection.method === "blocked") return false;
  return true;
}

export async function inspectTextPatch(
  bytes: ArrayBuffer,
  patch: TextPatch,
): Promise<TextEditInspection> {
  const original = patch.originalText ?? "";
  const missingGlyphs = charsMissingFromWinAnsi(patch.text);
  const heuristic = matchFont({
    fontName: patch.fontName,
    fontFamily: patch.fontFamily,
  });

  if (!original.trim()) {
    return buildInspection(false, heuristic, missingGlyphs, false);
  }

  const doc = await loadDoc(bytes);
  const page = doc.getPages()[patch.page - 1];
  if (!page) return buildInspection(false, heuristic, missingGlyphs, false);

  const streams = pageContentStreams(doc, page);
  const located = findShow(streams, patch, original);
  const fonts = readPageFonts(page);
  const fontInfo = located ? fonts.get(located.show.fontName) : undefined;
  const match = matchFont({
    fontName: patch.fontName,
    fontFamily: patch.fontFamily,
    baseFont: fontInfo?.baseFont,
  });
  const reuse = located ? canReuseEmbeddedFont(fontInfo, original, patch.text) : false;
  return buildInspection(!!located, match, missingGlyphs, reuse, fontInfo?.baseFont);
}

export async function applyTextPatchesWithReport(
  bytes: ArrayBuffer,
  patches: TextPatch[],
): Promise<{ bytes: Uint8Array; reports: TextEditReport[] }> {
  const doc = await loadDoc(bytes);
  const pages = doc.getPages();
  const reports: TextEditReport[] = [];
  const byPage = new Map<number, TextPatch[]>();

  for (const patch of patches) {
    const list = byPage.get(patch.page) ?? [];
    list.push(patch);
    byPage.set(patch.page, list);
  }

  const fontCache = new Map<StandardFonts, PDFFont>();
  const embed = async (id: StandardFonts) => {
    const hit = fontCache.get(id);
    if (hit) return hit;
    const font = await doc.embedFont(id);
    fontCache.set(id, font);
    return font;
  };

  for (const [pageNumber, pagePatches] of byPage) {
    const page = pages[pageNumber - 1];
    if (!page) {
      for (const patch of pagePatches) {
        reports.push(blockedReport(patch, matchFont(patch), "Page is missing."));
      }
      continue;
    }

    const streams = pageContentStreams(doc, page);
    const fonts = readPageFonts(page);

    for (const patch of pagePatches) {
      const original = patch.originalText ?? "";
      const nextText = patch.text.replace(/\s*\n\s*/g, " ");
      const missingGlyphs = charsMissingFromWinAnsi(nextText);
      const located = original ? findShow(streams, patch, original) : null;
      const fontInfo = located ? fonts.get(located.show.fontName) : undefined;
      const match = matchFont({
        fontName: patch.fontName,
        fontFamily: patch.fontFamily,
        baseFont: fontInfo?.baseFont,
      });

      if (!located) {
        reports.push(
          blockedReport(patch, match, "Original text operator was not found on this page."),
        );
        continue;
      }
      if (missingGlyphs.length > 0 || match.kind === "unsafe") {
        reports.push(blockedReport(patch, match, describeFontMatch(match, missingGlyphs)));
        continue;
      }

      const reuse = canReuseEmbeddedFont(fontInfo, original, nextText);
      if (reuse) {
        const size = shrinkSize(nextText, located.show.fontSize || patch.fontSize, patch.width);
        located.stream.tokens = replaceShowText(located.stream.tokens, located.show, nextText);
        if (Math.abs(size - (located.show.fontSize || patch.fontSize)) > 0.05) {
          const shows = collectTextShows(located.stream.tokens);
          const again = shows.find(
            (s) =>
              normalizePdfText(s.text) === normalizePdfText(nextText) &&
              Math.hypot(s.x - located.show.x, s.y - located.show.y) < 1.5,
          );
          if (again) updateTfSize(located.stream.tokens, again, size);
        }
        located.stream.dirty = true;
        reports.push({
          page: patch.page,
          originalText: original,
          text: nextText,
          method: "in-place",
          fontMatch: match,
          fontLabel: fontInfo?.baseFont || match.label,
          missingGlyphs,
          found: true,
        });
        continue;
      }

      const stdFont = await embed(match.standard);
      const size = shrinkSize(
        nextText,
        located.show.fontSize || patch.fontSize,
        patch.width,
        stdFont,
      );
      const fontKey = ensurePageFont(page, stdFont);
      located.stream.tokens = removeShow(located.stream.tokens, located.show);
      appendRedraw(located.stream, { ...patch, text: nextText }, located.show, fontKey, size);
      located.stream.dirty = true;
      reports.push({
        page: patch.page,
        originalText: original,
        text: nextText,
        method: "redraw-standard",
        fontMatch: match,
        fontLabel: match.label,
        missingGlyphs,
        found: true,
        warning: `Original font ${fontInfo?.baseFont || "embedded subset"} cannot safely encode the new characters; wrote ${match.label} at the same baseline.`,
      });
    }

    for (const stream of streams) {
      if (stream.dirty) writeStream(doc, stream, page);
    }
  }

  const blocked = reports.filter((r) => r.method === "blocked");
  if (blocked.length > 0) {
    const names = blocked.map((r) => `“${r.originalText}”`).join(", ");
    throw new SafeEditError(
      `Could not safely replace ${blocked.length} run(s): ${names}. Nothing was written — the original file is unchanged.`,
      reports,
    );
  }

  const bytesOut = await doc.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
  return { bytes: bytesOut, reports };
}

export class SafeEditError extends Error {
  reports: TextEditReport[];
  constructor(message: string, reports: TextEditReport[]) {
    super(message);
    this.name = "SafeEditError";
    this.reports = reports;
  }
}

function blockedReport(patch: TextPatch, match: FontMatch, warning: string): TextEditReport {
  return {
    page: patch.page,
    originalText: patch.originalText ?? "",
    text: patch.text,
    method: "blocked",
    fontMatch: match,
    fontLabel: match.label,
    missingGlyphs: charsMissingFromWinAnsi(patch.text),
    found: false,
    warning,
  };
}

export async function applyTextPatches(
  bytes: ArrayBuffer,
  patches: TextPatch[],
): Promise<Uint8Array> {
  const { bytes: out } = await applyTextPatchesWithReport(bytes, patches);
  return out;
}

/** Test helper: decoded text-show strings on a page, in stream order. */
export async function listPageShownText(bytes: ArrayBuffer, pageNumber: number): Promise<string[]> {
  const doc = await loadDoc(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return [];
  const streams = pageContentStreams(doc, page);
  return streams.flatMap((s) => extractShownStrings(s.tokens));
}

export async function pageHasWhiteCover(
  bytes: ArrayBuffer,
  pageNumber: number,
  box: { x: number; y: number; width: number; height: number },
): Promise<boolean> {
  const doc = await loadDoc(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return false;
  const streams = pageContentStreams(doc, page);
  return streams.some((s) => hasWhiteCoverRect(s.tokens, box));
}

/** Decode every content stream on a page (for untouched-page regression). */
export async function decodePageContent(bytes: ArrayBuffer, pageNumber: number): Promise<string> {
  const doc = await loadDoc(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return "";
  const streams = pageContentStreams(doc, page);
  return streams.map((s) => extractShownStrings(s.tokens).join("\n")).join("\n");
}
