/**
 * Map a PDF font name onto a Standard 14 stand-in and check WinAnsi coverage.
 *
 * We never ask the user to download or activate Creative Cloud fonts. If the
 * page already uses a Standard 14 font (or a WinAnsi cousin we can encode),
 * replacement text is written in that encoding. Characters we cannot encode
 * are reported instead of being written as .notdef / "?".
 */

import { StandardFonts } from "pdf-lib";

export type FontFamilyKind = "helvetica" | "times" | "courier" | "symbol" | "unknown";

export type FontMatchKind =
  "embedded-standard" | "standard-same-family" | "standard-fallback" | "unsafe";

export type FontMatch = {
  kind: FontMatchKind;
  standard: StandardFonts;
  label: string;
  family: FontFamilyKind;
  bold: boolean;
  italic: boolean;
};

/** Unicode code points that WinAnsi (win-1252) can encode. */
const WINANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const WINANSI_BYTE_TO_UNICODE: Record<number, number> = Object.fromEntries(
  Object.entries(WINANSI_EXTRA).map(([unicode, byte]) => [byte, Number(unicode)]),
);

export function canEncodeWinAnsiChar(codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return true;
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true;
  return codePoint in WINANSI_EXTRA;
}

export function charsMissingFromWinAnsi(text: string): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || canEncodeWinAnsiChar(cp)) continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    missing.push(ch);
  }
  return missing;
}

export function encodeWinAnsiBytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    if (cp >= 0x20 && cp <= 0x7e) bytes.push(cp);
    else if (cp === 0x09 || cp === 0x0a || cp === 0x0d) bytes.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) bytes.push(cp);
    else {
      const mapped = WINANSI_EXTRA[cp];
      if (mapped === undefined) {
        throw new Error(`WinAnsi cannot encode “${ch}”.`);
      }
      bytes.push(mapped);
    }
  }
  return Uint8Array.from(bytes);
}

export function decodeWinAnsiBytes(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e) out += String.fromCharCode(byte);
    else if (byte >= 0xa0 && byte <= 0xff) out += String.fromCharCode(byte);
    else if (byte === 0x09 || byte === 0x0a || byte === 0x0d) out += String.fromCharCode(byte);
    else {
      const unicode = WINANSI_BYTE_TO_UNICODE[byte];
      out += unicode === undefined ? String.fromCharCode(byte) : String.fromCharCode(unicode);
    }
  }
  return out;
}

const STANDARD_BASE_FONTS: Record<string, StandardFonts> = {
  helvetica: StandardFonts.Helvetica,
  "helvetica-bold": StandardFonts.HelveticaBold,
  "helvetica-oblique": StandardFonts.HelveticaOblique,
  "helvetica-boldoblique": StandardFonts.HelveticaBoldOblique,
  "times-roman": StandardFonts.TimesRoman,
  times: StandardFonts.TimesRoman,
  "times-bold": StandardFonts.TimesRomanBold,
  "times-italic": StandardFonts.TimesRomanItalic,
  "times-bolditalic": StandardFonts.TimesRomanBoldItalic,
  courier: StandardFonts.Courier,
  "courier-bold": StandardFonts.CourierBold,
  "courier-oblique": StandardFonts.CourierOblique,
  "courier-boldoblique": StandardFonts.CourierBoldOblique,
};

export function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

export function normalizeFontKey(name: string): string {
  return stripSubsetPrefix(name)
    .replace(/[,_]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/mt$/i, "")
    .replace(/ps$/i, "")
    .toLowerCase();
}

function looksBold(name: string): boolean {
  return /bold|black|heavy|semibold|demi/i.test(name);
}

function looksItalic(name: string): boolean {
  return /italic|oblique|obli/i.test(name);
}

function familyFromName(name: string): FontFamilyKind {
  const n = name.toLowerCase();
  if (/symbol|zapf|dingbat|wingding/.test(n)) return "symbol";
  if (
    /courier|consolas|monaco|menlo|liberation.?mono|nimbus.?mono|lucida.?console|andale.?mono/.test(
      n,
    )
  ) {
    return "courier";
  }
  if (
    /times|georgia|garamond|palatino|cambria|constantia|liberation.?serif|nimbus.?roman|century|bookman|baskerville/.test(
      n,
    )
  ) {
    return "times";
  }
  if (
    /helvetica|arial|swiss|univers|calibri|carlito|liberation.?sans|nimbus.?sans|neue.?haas|frutiger|myriad|gill.?sans|verdana|tahoma|trebuchet|segoe/.test(
      n,
    )
  ) {
    return "helvetica";
  }
  if (/\bserif\b/.test(n) && !/sans/.test(n)) return "times";
  if (/sans/.test(n) || /ui-sans/.test(n)) return "helvetica";
  if (/mono/.test(n)) return "courier";
  return "unknown";
}

function standardFor(family: FontFamilyKind, bold: boolean, italic: boolean): StandardFonts {
  if (family === "times") {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (family === "courier") {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

function labelFor(standard: StandardFonts): string {
  switch (standard) {
    case StandardFonts.HelveticaBold:
      return "Helvetica-Bold";
    case StandardFonts.HelveticaOblique:
      return "Helvetica-Oblique";
    case StandardFonts.HelveticaBoldOblique:
      return "Helvetica-BoldOblique";
    case StandardFonts.TimesRoman:
      return "Times-Roman";
    case StandardFonts.TimesRomanBold:
      return "Times-Bold";
    case StandardFonts.TimesRomanItalic:
      return "Times-Italic";
    case StandardFonts.TimesRomanBoldItalic:
      return "Times-BoldItalic";
    case StandardFonts.Courier:
      return "Courier";
    case StandardFonts.CourierBold:
      return "Courier-Bold";
    case StandardFonts.CourierOblique:
      return "Courier-Oblique";
    case StandardFonts.CourierBoldOblique:
      return "Courier-BoldOblique";
    default:
      return "Helvetica";
  }
}

export function isExactStandardBaseFont(baseFont: string): boolean {
  const key = normalizeFontKey(baseFont);
  return key in STANDARD_BASE_FONTS && !/^[A-Z]{6}\+/.test(baseFont);
}

export function matchFont(input: {
  fontName?: string | undefined;
  fontFamily?: string | undefined;
  baseFont?: string | undefined;
}): FontMatch {
  const raw = [input.baseFont, input.fontName, input.fontFamily].filter(Boolean).join(" ");
  const base = input.baseFont ? stripSubsetPrefix(input.baseFont) : "";
  const exactKey = base ? normalizeFontKey(base) : "";
  const exact = exactKey ? STANDARD_BASE_FONTS[exactKey] : undefined;
  const family = familyFromName(raw || base || "helvetica");
  const bold = looksBold(raw);
  const italic = looksItalic(raw);
  const standard = exact ?? standardFor(family, bold, italic);
  const subset = input.baseFont ? /^[A-Z]{6}\+/.test(input.baseFont) : false;

  let kind: FontMatchKind;
  if (family === "symbol") kind = "unsafe";
  else if (exact && !subset && input.baseFont) kind = "embedded-standard";
  else if (family !== "unknown")
    kind = exact || input.baseFont ? "standard-same-family" : "standard-same-family";
  else kind = "standard-fallback";

  if (family === "unknown" && !exact) kind = "standard-fallback";

  return {
    kind,
    standard,
    label: labelFor(standard),
    family: family === "symbol" ? "symbol" : family === "unknown" ? "helvetica" : family,
    bold,
    italic,
  };
}

export function describeFontMatch(match: FontMatch, missingGlyphs: string[]): string {
  if (missingGlyphs.length > 0) {
    return `Cannot encode ${missingGlyphs.map((c) => `“${c}”`).join(" ")} in a Standard 14 font — export would write “?”.`;
  }
  if (match.kind === "embedded-standard") {
    return `Uses the page’s ${match.label} (Standard 14, already in the file).`;
  }
  if (match.kind === "standard-same-family") {
    return `Will write ${match.label} — same family as the original, no Creative Cloud font needed.`;
  }
  if (match.kind === "unsafe") {
    return "This run uses a symbol / dingbat font. Replacement is blocked so we do not write .notdef glyphs.";
  }
  return `Will write ${match.label} as a Standard 14 stand-in. Metrics may differ slightly.`;
}
