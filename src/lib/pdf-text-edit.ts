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
 *     the old show and appends a stand-in — Standard 14 when WinAnsi covers
 *     the text, otherwise a bundled SIL OFL TTF via fontkit (PRIOR_ART #1).
 *     Never a cover rect.
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
  encodePdfHex,
  encodePdfLiteral,
  extractShownStrings,
  findFuzzySpan,
  hasTextOperators,
  hasWhiteCoverRect,
  looseAmountKey,
  normalizePdfText,
  removeShow,
  replaceShowBytes,
  replaceShowText,
  softMatchKey,
  spliceHaystack,
  streamTextMatchesVisual,
  textMatchKey,
  tokenizeContentStream,
  tokensToBytes,
  type TextShow,
  type Token,
  shiftShowUserPosition,
} from "./pdf-content-stream";
import {
  charsMissingFromWinAnsi,
  describeFontMatch,
  isExactStandardBaseFont,
  looksLikeUtf16Be,
  matchFont,
  type FontMatch,
} from "./pdf-font-match";
import type { EmbeddedFontInfo, FontChoice } from "./pdf-font-catalog";
import {
  embedUnicodeFallbackFont,
  registerPdfFontkit,
  resolveUnicodeFallback,
} from "./pdf-unicode-fonts";
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
  /** Content-stream decode when it differs from originalText (CID / custom encoding). */
  rawText?: string;
  fontName?: string;
  fontFamily?: string;
  fontChoice?: FontChoice;
  /**
   * Member boxes for marquee / multi-run selections. Locate and rewrite only
   * operators that intersect these, not everything in the union gutter.
   */
  coverBoxes?: Array<{ x: number; y: number; width: number; height: number }>;
  /**
   * Extra boxes from a joined / expanded line (description + amount columns).
   * Rewrite must cover every overlapping show in these boxes, not only the
   * first description operator.
   */
  memberBoxes?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
  }>;
  /**
   * Destination user-space origin after align / nudge. Locate the operator
   * at `x,y` (extract-time); write the Tm/Td so the show lands here.
   */
  targetX?: number;
  targetY?: number;
};

export type TextEditMethod =
  "in-place" | "redraw-standard" | "redraw-system" | "redraw-unicode" | "blocked";

export type TextEditBlockReason =
  "not-found" | "scan-page" | "missing-glyphs" | "unsafe-font" | null;

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
  deferToScan?: boolean;
};

export type TextEditInspection = {
  found: boolean;
  method: TextEditMethod;
  fontMatch: FontMatch;
  fontLabel: string;
  missingGlyphs: string[];
  baseFont?: string;
  message: string;
  deferToScan?: boolean;
  blockReason?: TextEditBlockReason;
  embeddedFonts?: EmbeddedFontInfo[];
  resourceKey?: string;
};

export type TextLayerKind = "operators" | "none";

export type TextLayerInspection = {
  kind: TextLayerKind;
  showCount: number;
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

function allPageStreams(doc: PDFDocument, page: PDFPage): PageStream[] {
  return [...pageContentStreams(doc, page), ...formContentStreams(doc, page)];
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

type FontInfo = EmbeddedFontInfo;

function readEncodingName(doc: PDFDocument, fontDict: PDFDict): string {
  const raw = fontDict.get(PDFName.of("Encoding"));
  const obj = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  if (obj instanceof PDFName) return obj.decodeText();
  if (obj instanceof PDFDict) {
    const base = obj.lookupMaybe(PDFName.of("BaseEncoding"), PDFName);
    return base?.decodeText() || "Custom";
  }
  return "";
}

function readFontDict(doc: PDFDocument, fonts: PDFDict, into: Map<string, FontInfo>) {
  for (const [name, value] of fonts.entries()) {
    const dict = doc.context.lookup(value);
    if (!(dict instanceof PDFDict)) continue;
    const base = dict.lookupMaybe(PDFName.of("BaseFont"), PDFName);
    const subtype = dict.lookupMaybe(PDFName.of("Subtype"), PDFName);
    const baseFont = base?.decodeText() ?? "";
    const encodingName = readEncodingName(doc, dict);
    const subtypeName = subtype?.decodeText() ?? "";
    into.set(name.decodeText(), {
      key: name.decodeText(),
      baseFont,
      encoding: encodingName,
      subset: /^[A-Z]{6}\+/.test(baseFont),
      standard: isExactStandardBaseFont(baseFont),
      cid: subtypeName === "Type0" || /identity/i.test(encodingName),
    });
  }
}

function readPageFonts(page: PDFPage): Map<string, FontInfo> {
  const map = new Map<string, FontInfo>();
  const resources = page.node.Resources();
  const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (fonts) readFontDict(page.doc, fonts, map);

  const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (xobjects) {
    for (const [, value] of xobjects.entries()) {
      const obj = page.doc.context.lookup(value);
      if (!(obj instanceof PDFStream) && !(obj instanceof PDFRawStream)) continue;
      const dict = (obj as PDFRawStream).dict;
      if (!dict) continue;
      if (dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Form")) continue;
      const formFonts = dict
        .lookupMaybe(PDFName.of("Resources"), PDFDict)
        ?.lookupMaybe(PDFName.of("Font"), PDFDict);
      if (formFonts) readFontDict(page.doc, formFonts, map);
    }
  }
  return map;
}

type LocatedShows = { stream: PageStream; shows: TextShow[]; score: number };

function joinedShowText(shows: TextShow[]): string[] {
  const raw = shows.map((show) => show.text);
  const spaced = raw.join(" ").replace(/\s+/g, " ").trim();
  return [...new Set([raw.join(""), raw.join(" "), spaced])];
}

function textScoreForShows(shows: TextShow[], original: string): number | null {
  const origKey = textMatchKey(original);
  const origLoose = looseAmountKey(original);
  const origSoft = softMatchKey(original);
  if (!origKey) return null;
  let best: number | null = null;
  for (const candidate of joinedShowText(shows)) {
    if (textMatchKey(candidate) === origKey) return 1000;
    if (origLoose && looseAmountKey(candidate) === origLoose) best = Math.max(best ?? 0, 860);
    if (origSoft && softMatchKey(candidate) === origSoft) best = Math.max(best ?? 0, 840);
    const span = findFuzzySpan(candidate, original);
    if (span) {
      const extra = Math.max(0, candidate.length - original.length);
      // Prefer a span inside a single show (neighbors stay in that operator).
      const base = shows.length === 1 ? 740 : 680;
      best = Math.max(best ?? 0, base - extra * 0.05);
    }
  }
  return best;
}

function scoreShows(shows: TextShow[], patch: TextPatch, original: string): number | null {
  const textScore = textScoreForShows(shows, original);
  if (textScore === null) return null;
  const first = shows[0];
  if (!first) return null;
  return textScore - Math.hypot(first.x - patch.x, first.y - patch.y);
}

function patchNeedles(patch: TextPatch, original: string): string[] {
  const out: string[] = [];
  for (const candidate of [original, patch.rawText]) {
    const trimmed = candidate?.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function sameBaseline(a: TextShow, b: TextShow): boolean {
  return Math.abs(a.y - b.y) <= Math.max(2, Math.max(a.fontSize, b.fontSize) * 0.5);
}

function showWidth(show: TextShow): number {
  return Math.max(show.fontSize * 0.6, show.text.length * (show.fontSize || 10) * 0.5);
}

function showOverlapsBox(
  show: TextShow,
  box: { x: number; y: number; width: number; height: number },
  fallbackFontSize: number,
): boolean {
  const showW = showWidth(show);
  const showH = Math.max(show.fontSize || fallbackFontSize, 4);
  const pad = Math.max(4, showH * 0.3);
  const overlapX =
    Math.min(show.x + showW, box.x + box.width + pad) - Math.max(show.x, box.x - pad);
  if (overlapX <= 0) return false;
  const overlapY =
    Math.min(show.y + showH, box.y + (box.height || showH)) - Math.max(show.y, box.y);
  if (overlapY > 0) return true;
  const band = Math.max(4, Math.max(showH, box.height || showH) * 0.55);
  return Math.abs(show.y - box.y) <= band;
}

function showOverlapsPatch(show: TextShow, patch: TextPatch): boolean {
  const boxes = patch.coverBoxes?.length
    ? patch.coverBoxes
    : [{ x: patch.x, y: patch.y, width: patch.width, height: patch.height }];
  return boxes.some((box) => showOverlapsBox(show, box, patch.fontSize || 10));
}

function showCoveredByPatch(show: TextShow, patch: TextPatch): boolean {
  if (showOverlapsPatch(show, patch)) return true;
  for (const box of patch.memberBoxes ?? []) {
    if (
      showOverlapsPatch(show, {
        ...patch,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })
    ) {
      return true;
    }
  }
  return false;
}

function showTextInOriginal(show: TextShow, original: string): boolean {
  const orig = textMatchKey(original);
  const t = textMatchKey(show.text);
  if (t.length >= 2 && orig.includes(t)) return true;
  const loose = looseAmountKey(show.text);
  const origLoose = looseAmountKey(original);
  if (loose.length >= 2 && origLoose.includes(loose)) return true;
  return !!findFuzzySpan(original, show.text);
}

/**
 * A joined-line match often hits the description show first (PDF.js rawText is
 * the left run). Pull in every same-baseline operator the draft actually
 * covered — far-right amounts included — so dropRest can delete them.
 */
function expandLocatedShows(
  located: LocatedShows,
  streams: PageStream[],
  patch: TextPatch,
  original: string,
): LocatedShows {
  const head = located.shows[0];
  if (!head) return located;
  const origKey = textMatchKey(original);
  const headKey = textMatchKey(head.text);
  const originalLooksJoined = origKey.length > headKey.length + 2;
  const patchLooksWide = patch.width > showWidth(head) * 1.35;
  const hasMembers = (patch.memberBoxes?.length ?? 0) > 1 || (patch.coverBoxes?.length ?? 0) > 1;
  if (!originalLooksJoined && !patchLooksWide && !hasMembers) return located;

  const seen = new Set(
    located.shows.map((show) => `${show.start}:${show.x.toFixed(2)}:${show.y.toFixed(2)}`),
  );
  const extra: TextShow[] = [];
  for (const stream of streams) {
    if (stream !== located.stream) continue;
    for (const show of collectTextShows(stream.tokens)) {
      const id = `${show.start}:${show.x.toFixed(2)}:${show.y.toFixed(2)}`;
      if (seen.has(id)) continue;
      if (!sameBaseline(head, show)) continue;
      if (!showCoveredByPatch(show, patch)) continue;
      if (!hasMembers && !showTextInOriginal(show, original)) continue;
      seen.add(id);
      extra.push(show);
    }
  }
  if (extra.length === 0) return located;
  const shows = [...located.shows, ...extra].sort((a, b) => a.x - b.x || a.start - b.start);
  return { ...located, shows, score: located.score + extra.length };
}

function dropCoveredShowsOnOtherStreams(
  streams: PageStream[],
  located: LocatedShows,
  patch: TextPatch,
  original: string,
) {
  const head = located.shows[0];
  if (!head) return;
  const origKey = textMatchKey(original);
  const headKey = textMatchKey(head.text);
  const originalLooksJoined = origKey.length > headKey.length + 2;
  const patchLooksWide = patch.width > showWidth(head) * 1.35;
  const hasMembers = (patch.memberBoxes?.length ?? 0) > 1 || (patch.coverBoxes?.length ?? 0) > 1;
  if (!originalLooksJoined && !patchLooksWide && !hasMembers) return;

  for (const stream of streams) {
    if (stream === located.stream) continue;
    const extras = collectTextShows(stream.tokens).filter((show) => {
      if (!sameBaseline(head, show)) return false;
      if (!showCoveredByPatch(show, patch)) return false;
      return hasMembers || showTextInOriginal(show, original);
    });
    if (extras.length === 0) continue;
    dropTrailingShows(stream, extras);
    stream.dirty = true;
  }
}

function findShowsByBox(streams: PageStream[], patch: TextPatch): LocatedShows | null {
  let best: LocatedShows | null = null;
  for (const stream of streams) {
    const hits = collectTextShows(stream.tokens).filter((show) => showOverlapsPatch(show, patch));
    if (hits.length === 0) continue;
    hits.sort((a, b) => a.x - b.x);
    const first = hits[0];
    if (!first) continue;
    const score =
      520 - Math.hypot(first.x - patch.x, first.y - patch.y) + Math.min(hits.length, 40);
    if (!best || score > best.score) best = { stream, shows: hits, score };
  }
  return best;
}

function findShows(
  streams: PageStream[],
  patch: TextPatch,
  original: string,
): { stream: PageStream; shows: TextShow[] } | null {
  let best: LocatedShows | null = null;
  const consider = (
    stream: PageStream,
    shows: TextShow[],
    needle: string,
    current: LocatedShows | null,
  ) => {
    const score = scoreShows(shows, patch, needle);
    if (score === null) return current;
    if (
      !current ||
      score > current.score ||
      (score === current.score && shows.length > current.shows.length)
    ) {
      return { stream, shows, score };
    }
    return current;
  };

  for (const needle of patchNeedles(patch, original)) {
    for (const stream of streams) {
      const shows = collectTextShows(stream.tokens);
      for (let i = 0; i < shows.length; i++) {
        const first = shows[i];
        if (!first) continue;
        best = consider(stream, [first], needle, best);
        const group = [first];
        for (let j = i + 1; j < shows.length && group.length < 80; j++) {
          const next = shows[j];
          if (!next || !sameBaseline(first, next)) break;
          if (next.x + 4 < group[group.length - 1]!.x) break;
          group.push(next);
          best = consider(stream, [...group], needle, best);
        }
      }
    }
  }

  if (best) {
    const expanded = expandLocatedShows(best, streams, patch, original);
    return { stream: expanded.stream, shows: expanded.shows };
  }

  const boxed = findShowsByBox(streams, patch);
  if (boxed) {
    const expanded = expandLocatedShows(boxed, streams, patch, original);
    return { stream: expanded.stream, shows: expanded.shows };
  }

  // Position fallback: same baseline, nearby x, similar digits/letters.
  const origLoose = looseAmountKey(original) || looseAmountKey(patch.rawText ?? "");
  if (!origLoose) return null;
  let positional: LocatedShows | null = null;
  for (const stream of streams) {
    for (const show of collectTextShows(stream.tokens)) {
      if (Math.abs(show.y - patch.y) > Math.max(4, show.fontSize)) continue;
      if (Math.abs(show.x - patch.x) > Math.max(patch.width, 80)) continue;
      if (looseAmountKey(show.text) !== origLoose && !findFuzzySpan(show.text, original)) continue;
      const score = 400 - Math.hypot(show.x - patch.x, show.y - patch.y);
      if (!positional || score > positional.score) positional = { stream, shows: [show], score };
    }
  }
  if (!positional) return null;
  const expanded = expandLocatedShows(positional, streams, patch, original);
  return { stream: expanded.stream, shows: expanded.shows };
}

function resolveWrite(
  located: { shows: TextShow[] },
  original: string,
  nextText: string,
): { text: string; dropRest: boolean; glyphSource: string } {
  const shows = located.shows;
  const head = shows[0];
  if (!head) return { text: nextText, dropRest: false, glyphSource: original };

  if (shows.length === 1) {
    const spliced = spliceHaystack(head.text, original, nextText);
    const exact =
      textMatchKey(head.text) === textMatchKey(original) ||
      softMatchKey(head.text) === softMatchKey(original) ||
      (!!looseAmountKey(original) && looseAmountKey(head.text) === looseAmountKey(original));
    if (exact) return { text: nextText, dropRest: false, glyphSource: head.text };
    if (spliced) return { text: spliced, dropRest: false, glyphSource: head.text };
    return { text: nextText, dropRest: false, glyphSource: head.text };
  }

  const joined = shows.map((show) => show.text).join("");
  const joinedSp = shows.map((show) => show.text).join(" ");
  const exactJoined = [joined, joinedSp].some(
    (candidate) =>
      textMatchKey(candidate) === textMatchKey(original) ||
      softMatchKey(candidate) === softMatchKey(original),
  );
  if (exactJoined) return { text: nextText, dropRest: true, glyphSource: joined };
  const spliced =
    spliceHaystack(joined, original, nextText) ?? spliceHaystack(joinedSp, original, nextText);
  if (spliced) return { text: spliced, dropRest: true, glyphSource: joined };
  return { text: nextText, dropRest: true, glyphSource: joined };
}

function encodeReusingGlyphs(
  original: string,
  originalBytes: Uint8Array,
  next: string,
): Uint8Array | null {
  const chars = [...original];
  if (!chars.length || !originalBytes.length) return null;
  const unit =
    originalBytes.length === chars.length * 2 ? 2 : originalBytes.length === chars.length ? 1 : 0;
  if (!unit) return null;
  const map = new Map<string, Uint8Array>();
  for (let i = 0; i < chars.length; i++) {
    map.set(chars[i]!, originalBytes.subarray(i * unit, (i + 1) * unit));
  }
  const out: number[] = [];
  for (const ch of next) {
    let slice = map.get(ch);
    if (!slice && ch === " ") {
      slice = map.get(" ") ?? (unit === 2 ? Uint8Array.of(0, 0x20) : Uint8Array.of(0x20));
    }
    if (!slice) return null;
    for (const byte of slice) out.push(byte);
  }
  return Uint8Array.from(out);
}

function canReuseEmbeddedFont(
  info: FontInfo | undefined,
  original: string,
  next: string,
  show?: TextShow,
  visual?: string,
): boolean {
  if (!info) return false;
  if (visual && visual.trim() && !streamTextMatchesVisual(original, visual)) return false;
  if (info.cid) {
    return !!(show && encodeReusingGlyphs(original, show.bytes, next));
  }
  if (info.subset) {
    const originalSet = new Set(original);
    return [...next].every((ch) => ch === " " || originalSet.has(ch));
  }
  if (info.standard) return charsMissingFromWinAnsi(next).length === 0;
  if (/winansi/i.test(info.encoding)) return charsMissingFromWinAnsi(next).length === 0;
  return !!(show && encodeReusingGlyphs(original, show.bytes, next));
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
  encoded?: Token,
) {
  const color = show.fill;
  const text = patch.text.replace(/\s*\n\s*/g, " ");
  const textToken = encoded ?? encodePdfLiteral(text);
  const x = typeof patch.targetX === "number" ? patch.targetX : show.x;
  const y = typeof patch.targetY === "number" ? patch.targetY : show.y;
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
    textToken,
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
  extras: {
    baseFont?: string;
    deferToScan?: boolean;
    blockReason?: TextEditBlockReason;
    embeddedFonts?: EmbeddedFontInfo[];
    resourceKey?: string;
    systemRedraw?: boolean;
    unicodeRedraw?: boolean;
    unicodeLabel?: string;
  } = {},
): TextEditInspection {
  let method: TextEditMethod = "blocked";
  let blockReason: TextEditBlockReason = extras.blockReason ?? null;
  if (extras.deferToScan) {
    method = "blocked";
    blockReason = "scan-page";
  } else if (missingGlyphs.length > 0) {
    method = "blocked";
    blockReason = "missing-glyphs";
  } else if (match.kind === "unsafe") {
    method = "blocked";
    blockReason = "unsafe-font";
  } else if (found && reuse) method = "in-place";
  else if (found && extras.systemRedraw) method = "redraw-system";
  else if (found && extras.unicodeRedraw) method = "redraw-unicode";
  else if (found) method = "redraw-standard";
  else {
    method = "blocked";
    blockReason = blockReason ?? "not-found";
  }

  const fontLabel = extras.unicodeLabel
    ? extras.unicodeLabel
    : extras.deferToScan
      ? extras.baseFont || match.label
      : !found
        ? "No text operator"
        : extras.baseFont || match.label;
  const message = extras.deferToScan
    ? "This page has no text operators (likely a scan). Safe rewrite would invent an overlay. Use Enhance page or Scan to OCR it instead."
    : method === "blocked" && !found
      ? "This run was not found as a text operator on the page. If the page is a scan or OCR ghost, use Enhance page instead of rewriting Helvetica over the image. Export will refuse rather than paint over it."
      : describeFontMatch(match, missingGlyphs, extras.unicodeLabel);

  const inspection: TextEditInspection = {
    found,
    method,
    fontMatch: match,
    fontLabel,
    missingGlyphs,
    message,
    blockReason,
  };
  if (extras.baseFont) inspection.baseFont = extras.baseFont;
  if (extras.deferToScan) inspection.deferToScan = true;
  if (extras.embeddedFonts) inspection.embeddedFonts = extras.embeddedFonts;
  if (extras.resourceKey) inspection.resourceKey = extras.resourceKey;
  return inspection;
}

/**
 * Engine gate for *native* in-place rewrite. `deferToScan` means there is no
 * text operator to splice — a Safe edit would paint Helvetica over the image.
 *
 * Do not combine this with UI `scanMode` / false scan-detect. OCR lines skip
 * this function via `canApplyTextEdit` (`source === "ocr"` / `selectedIsOcr`).
 */
export function canCommitSafely(
  inspection: TextEditInspection | null,
  draft: string,
  original: string,
): boolean {
  if (!draft.trim() || draft.trim() === original) return true;
  if (!inspection) return true;
  if (inspection.deferToScan) return false;
  if (inspection.method === "blocked") return false;
  if (charsMissingFromWinAnsi(draft).length > 0) {
    return inspection.method === "redraw-unicode" || inspection.method === "redraw-system";
  }
  if (inspection.missingGlyphs.length > 0) return false;
  return true;
}

export async function inspectTextLayer(
  bytes: ArrayBuffer,
  pageNumber: number,
): Promise<TextLayerInspection> {
  const doc = await loadDoc(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) {
    return { kind: "none", showCount: 0, message: "Page is missing." };
  }
  const streams = allPageStreams(doc, page);
  const showCount = streams.reduce(
    (sum, stream) => sum + collectTextShows(stream.tokens).length,
    0,
  );
  const hasOps = streams.some((stream) => hasTextOperators(stream.tokens));
  if (!hasOps || showCount === 0) {
    return {
      kind: "none",
      showCount: 0,
      message:
        "No text operators on this page. Defer to the scan-aware flow instead of a fake Safe edit.",
    };
  }
  return {
    kind: "operators",
    showCount,
    message: `${showCount} text operator${showCount === 1 ? "" : "s"} on this page.`,
  };
}

export async function inspectTextPatch(
  bytes: ArrayBuffer,
  patch: TextPatch,
): Promise<TextEditInspection> {
  const original = patch.originalText ?? "";
  const winAnsiMissingEarly = charsMissingFromWinAnsi(patch.text);
  const heuristic = matchFont({
    fontName: patch.fontName,
    fontFamily: patch.fontFamily,
  });

  const doc = await loadDoc(bytes);
  const page = doc.getPages()[patch.page - 1];
  if (!page) return buildInspection(false, heuristic, winAnsiMissingEarly, false);

  const streams = allPageStreams(doc, page);
  const fonts = readPageFonts(page);
  const embeddedFonts = [...fonts.values()];
  const layerEmpty = !streams.some((stream) => hasTextOperators(stream.tokens));
  if (layerEmpty) {
    return buildInspection(false, heuristic, winAnsiMissingEarly, false, {
      deferToScan: true,
      blockReason: "scan-page",
      embeddedFonts,
    });
  }

  if (!original.trim()) {
    return buildInspection(false, heuristic, winAnsiMissingEarly, false, { embeddedFonts });
  }

  const located = findShows(streams, patch, original);
  const head = located?.shows[0];
  const fontInfo = head ? fonts.get(head.fontName) : undefined;
  const match = matchFont({
    fontName: patch.fontName,
    fontFamily: patch.fontFamily,
    baseFont: fontInfo?.baseFont,
  });
  const write = located ? resolveWrite(located, original, patch.text) : null;
  const encodingMismatch =
    !!write && !!original.trim() && !streamTextMatchesVisual(write.glyphSource, original);
  const reuse =
    located && write
      ? canReuseEmbeddedFont(fontInfo, write.glyphSource, write.text, head, original)
      : false;
  const winAnsiMissing = charsMissingFromWinAnsi(write?.text ?? patch.text);
  let missingGlyphs = reuse ? [] : winAnsiMissing;
  let unicodeRedraw = false;
  let unicodeLabel: string | undefined;
  const preferUnicodeStandin =
    !reuse &&
    match.kind !== "unsafe" &&
    (winAnsiMissing.length > 0 || !!fontInfo?.cid || encodingMismatch);
  if (preferUnicodeStandin) {
    const fallback = await resolveUnicodeFallback(write?.text ?? patch.text, match);
    if (fallback.ok) {
      missingGlyphs = [];
      unicodeRedraw = true;
      unicodeLabel = fallback.face.label;
    } else if (winAnsiMissing.length > 0) {
      missingGlyphs = fallback.missing;
    } else {
      missingGlyphs = [];
    }
  }
  const systemRedraw = patch.fontChoice?.source === "system" && !!patch.fontChoice.embedBytes;
  return buildInspection(!!located, match, missingGlyphs, reuse, {
    ...(fontInfo?.baseFont ? { baseFont: fontInfo.baseFont } : {}),
    embeddedFonts,
    ...(head?.fontName ? { resourceKey: head.fontName } : {}),
    systemRedraw,
    unicodeRedraw,
    ...(unicodeLabel ? { unicodeLabel } : {}),
  });
}

function patchDestination(
  patch: TextPatch,
  show: TextShow,
): { x: number; y: number; moved: boolean } {
  const x = typeof patch.targetX === "number" ? patch.targetX : show.x;
  const y = typeof patch.targetY === "number" ? patch.targetY : show.y;
  const moved = Math.abs(x - show.x) > 0.05 || Math.abs(y - show.y) > 0.05;
  return { x, y, moved };
}

function relocateShow(stream: PageStream, show: TextShow, x: number, y: number) {
  stream.tokens = shiftShowUserPosition(stream.tokens, show, x, y);
  stream.dirty = true;
}

function showAfterRewrite(
  stream: PageStream,
  previous: TextShow,
  text: string,
): TextShow | undefined {
  const shows = collectTextShows(stream.tokens);
  return (
    shows.find(
      (item) =>
        normalizePdfText(item.text) === normalizePdfText(text) &&
        Math.hypot(item.x - previous.x, item.y - previous.y) < 1.5,
    ) ?? shows.find((item) => Math.hypot(item.x - previous.x, item.y - previous.y) < 1.5)
  );
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

    const streams = allPageStreams(doc, page);
    const fonts = readPageFonts(page);
    const layerEmpty = !streams.some((stream) => hasTextOperators(stream.tokens));

    for (const patch of pagePatches) {
      const original = patch.originalText ?? "";
      const nextText = patch.text.replace(/\s*\n\s*/g, " ");
      const located = original ? findShows(streams, patch, original) : null;
      const head = located?.shows[0];
      const fontInfo = head ? fonts.get(head.fontName) : undefined;
      const match = matchFont({
        fontName: patch.fontName,
        fontFamily: patch.fontFamily,
        baseFont: fontInfo?.baseFont,
      });

      if (layerEmpty) {
        reports.push(
          blockedReport(
            patch,
            match,
            "This page has no text operators. Defer to Scan instead of painting over it.",
            true,
          ),
        );
        continue;
      }
      if (!located || !head) {
        reports.push(
          blockedReport(patch, match, "Original text operator was not found on this page."),
        );
        continue;
      }
      if (match.kind === "unsafe") {
        reports.push(blockedReport(patch, match, describeFontMatch(match, [])));
        continue;
      }

      const dest = patchDestination(patch, head);
      const textUnchanged = textMatchKey(nextText) === textMatchKey(original);
      if (textUnchanged && dest.moved) {
        relocateShow(located.stream, head, dest.x, dest.y);
        reports.push({
          page: patch.page,
          originalText: original,
          text: nextText,
          method: "in-place",
          fontMatch: match,
          fontLabel: fontInfo?.baseFont || match.label,
          missingGlyphs: [],
          found: true,
        });
        continue;
      }

      dropCoveredShowsOnOtherStreams(
        streams,
        { stream: located.stream, shows: located.shows, score: 0 },
        patch,
        original,
      );

      const write = resolveWrite(located, original, nextText);
      const encodingMismatch =
        !!original.trim() && !streamTextMatchesVisual(write.glyphSource, original);
      const reuse = canReuseEmbeddedFont(fontInfo, write.glyphSource, write.text, head, original);
      const winAnsiMissing = charsMissingFromWinAnsi(write.text);
      const systemBytes =
        patch.fontChoice?.source === "system" ? patch.fontChoice.embedBytes : undefined;
      const preferSystem = !!systemBytes && patch.fontChoice?.source === "system";
      const preferBundled =
        patch.fontChoice?.source === "bundled" || (!preferSystem && encodingMismatch);
      const writeWidth = Math.max(
        patch.width,
        write.dropRest
          ? patch.width
          : write.glyphSource.length * (head.fontSize || patch.fontSize) * 0.5,
      );
      const showsToDrop = write.dropRest ? located.shows.slice(1) : [];

      if (reuse && !preferSystem && !preferBundled) {
        const size = shrinkSize(write.text, head.fontSize || patch.fontSize, writeWidth);
        dropTrailingShows(located.stream, showsToDrop);
        const glyphBytes = write.dropRest ? concatShowBytes(located.shows) : head.bytes;
        const reusedBytes =
          looksLikeUtf16Be(head.bytes) || fontInfo?.cid
            ? encodeReusingGlyphs(write.glyphSource, glyphBytes, write.text)
            : null;
        if (reusedBytes) {
          located.stream.tokens = replaceShowBytes(
            located.stream.tokens,
            head,
            reusedBytes,
            write.text,
          );
        } else {
          located.stream.tokens = replaceShowText(located.stream.tokens, head, write.text);
        }
        if (Math.abs(size - (head.fontSize || patch.fontSize)) > 0.05) {
          const shows = collectTextShows(located.stream.tokens);
          const again = shows.find(
            (s) =>
              normalizePdfText(s.text) === normalizePdfText(write.text) &&
              Math.hypot(s.x - head.x, s.y - head.y) < 1.5,
          );
          if (again) updateTfSize(located.stream.tokens, again, size);
        }
        if (dest.moved) {
          const moved = showAfterRewrite(located.stream, head, write.text);
          if (moved) relocateShow(located.stream, moved, dest.x, dest.y);
        }
        located.stream.dirty = true;
        reports.push({
          page: patch.page,
          originalText: original,
          text: nextText,
          method: "in-place",
          fontMatch: match,
          fontLabel: fontInfo?.baseFont || match.label,
          missingGlyphs: [],
          found: true,
        });
        continue;
      }

      if (systemBytes) {
        try {
          await registerPdfFontkit(doc);
          const sysFont = await doc.embedFont(systemBytes, { subset: true });
          const size = shrinkSize(write.text, head.fontSize || patch.fontSize, writeWidth, sysFont);
          const fontKey = ensurePageFont(page, sysFont);
          const removed = write.dropRest ? located.shows : [head];
          for (const show of [...removed].reverse()) {
            located.stream.tokens = removeShow(located.stream.tokens, show);
          }
          const encoded = encodePdfHex(sysFont.encodeText(write.text).asBytes(), write.text);
          appendRedraw(
            located.stream,
            { ...patch, text: write.text },
            head,
            fontKey,
            size,
            encoded,
          );
          located.stream.dirty = true;
          reports.push({
            page: patch.page,
            originalText: original,
            text: nextText,
            method: "redraw-system",
            fontMatch: match,
            fontLabel:
              patch.fontChoice?.family || patch.fontChoice?.postscriptName || "system font",
            missingGlyphs: [],
            found: true,
            warning: `Wrote the local system font at the same baseline. The original resource was not reused.`,
          });
          continue;
        } catch {
          // Fall through to bundled Unicode or Standard 14 — never write a corrupt overlay.
        }
      }

      if (winAnsiMissing.length > 0 || preferBundled) {
        const fallback = await resolveUnicodeFallback(write.text, match);
        if (!fallback.ok) {
          reports.push(
            blockedReport(patch, match, describeFontMatch(match, fallback.missing), false),
          );
          continue;
        }
        const uniFont = await embedUnicodeFallbackFont(doc, fallback.face);
        const size = shrinkSize(write.text, head.fontSize || patch.fontSize, writeWidth, uniFont);
        const fontKey = ensurePageFont(page, uniFont);
        const removed = write.dropRest ? located.shows : [head];
        for (const show of [...removed].reverse()) {
          located.stream.tokens = removeShow(located.stream.tokens, show);
        }
        const encoded = encodePdfHex(uniFont.encodeText(write.text).asBytes(), write.text);
        appendRedraw(located.stream, { ...patch, text: write.text }, head, fontKey, size, encoded);
        located.stream.dirty = true;
        reports.push({
          page: patch.page,
          originalText: original,
          text: nextText,
          method: "redraw-unicode",
          fontMatch: match,
          fontLabel: fallback.face.label,
          missingGlyphs: [],
          found: true,
          warning: `Original font ${fontInfo?.baseFont || "embedded subset"} cannot encode the new characters in WinAnsi; embedded ${fallback.face.label} (SIL OFL, PRIOR_ART #1) at the same baseline.`,
        });
        continue;
      }

      const stdFont = await embed(match.standard);
      const size = shrinkSize(write.text, head.fontSize || patch.fontSize, writeWidth, stdFont);
      const fontKey = ensurePageFont(page, stdFont);
      const removedStd = write.dropRest ? located.shows : [head];
      for (const show of [...removedStd].reverse()) {
        located.stream.tokens = removeShow(located.stream.tokens, show);
      }
      appendRedraw(located.stream, { ...patch, text: write.text }, head, fontKey, size);
      located.stream.dirty = true;
      reports.push({
        page: patch.page,
        originalText: original,
        text: nextText,
        method: "redraw-standard",
        fontMatch: match,
        fontLabel: match.label,
        missingGlyphs: [],
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

function concatShowBytes(shows: TextShow[]): Uint8Array {
  const total = shows.reduce((sum, show) => sum + show.bytes.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const show of shows) {
    out.set(show.bytes, offset);
    offset += show.bytes.length;
  }
  return out;
}

function dropTrailingShows(stream: PageStream, shows: TextShow[]) {
  for (const show of [...shows].sort((a, b) => b.start - a.start)) {
    stream.tokens = removeShow(stream.tokens, show);
  }
}

function blockedReport(
  patch: TextPatch,
  match: FontMatch,
  warning: string,
  deferToScan = false,
): TextEditReport {
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
    deferToScan,
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
  const streams = allPageStreams(doc, page);
  return streams.flatMap((s) => extractShownStrings(s.tokens));
}

export async function listPageTextShows(
  bytes: ArrayBuffer,
  pageNumber: number,
): Promise<TextShow[]> {
  const doc = await loadDoc(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return [];
  const out: TextShow[] = [];
  for (const stream of allPageStreams(doc, page)) {
    try {
      out.push(...collectTextShows(stream.tokens));
    } catch {
      // Skip a corrupt stream rather than failing the whole page extract.
    }
  }
  return out;
}

export async function listPageEmbeddedFonts(
  bytes: ArrayBuffer,
  pageNumber: number,
): Promise<EmbeddedFontInfo[]> {
  const doc = await loadDoc(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return [];
  return [...readPageFonts(page).values()];
}

export async function pageHasWhiteCover(
  bytes: ArrayBuffer,
  pageNumber: number,
  box: { x: number; y: number; width: number; height: number },
): Promise<boolean> {
  const doc = await loadDoc(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return false;
  const streams = allPageStreams(doc, page);
  return streams.some((s) => hasWhiteCoverRect(s.tokens, box));
}

/** Decode every content stream on a page (for untouched-page regression). */
export async function decodePageContent(bytes: ArrayBuffer, pageNumber: number): Promise<string> {
  const doc = await loadDoc(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return "";
  const streams = allPageStreams(doc, page);
  return streams.map((s) => extractShownStrings(s.tokens).join("\n")).join("\n");
}

/** Inflated content-stream operators (for asserting `3 Tr` vs `/ca 0`). */
export async function decodePageContentRaw(
  bytes: ArrayBuffer,
  pageNumber: number,
): Promise<string> {
  const doc = await loadDoc(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return "";
  return allPageStreams(doc, page)
    .map((s) => s.tokens.map((token) => token.raw).join(""))
    .join("\n");
}
