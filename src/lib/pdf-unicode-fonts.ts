/**
 * Bundled SIL OFL faces for Unicode-safe redraws.
 *
 * Standard 14 is WinAnsi-only. When replacement text needs glyphs that
 * encoding cannot represent, we register `@pdf-lib/fontkit` and embed a
 * subset of Liberation Sans (Helvetica metrics) or Noto Sans (broader
 * Latin/Greek/Cyrillic). Never Creative Cloud. Never AGPL fonts.
 *
 * PRIOR_ART.md #1.
 */

import fontkit from "@pdf-lib/fontkit";
import type { Font } from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";
import type { FontMatch } from "./pdf-font-match";
import { foldPdfPunctuation } from "./pdf-font-match";

export type UnicodeFallbackFace = {
  file: string;
  label: string;
  bytes: Uint8Array;
};

export type UnicodeFallbackResult =
  { ok: true; face: UnicodeFallbackFace } | { ok: false; missing: string[] };

type BundledFace = {
  file: string;
  label: string;
  bold: boolean;
  italic: boolean;
};

const LIBERATION_SANS: BundledFace[] = [
  {
    file: "LiberationSans-Regular.ttf",
    label: "Liberation Sans",
    bold: false,
    italic: false,
  },
  {
    file: "LiberationSans-Bold.ttf",
    label: "Liberation Sans Bold",
    bold: true,
    italic: false,
  },
  {
    file: "LiberationSans-Italic.ttf",
    label: "Liberation Sans Italic",
    bold: false,
    italic: true,
  },
  {
    file: "LiberationSans-BoldItalic.ttf",
    label: "Liberation Sans Bold Italic",
    bold: true,
    italic: true,
  },
];

const NOTO_SANS: BundledFace = {
  file: "NotoSans-Regular.ttf",
  label: "Noto Sans",
  bold: false,
  italic: false,
};

const bytesCache = new Map<string, Uint8Array>();
const parsedCache = new Map<string, Font>();

function fontkitCreate(bytes: Uint8Array): Font | Promise<Font> {
  return fontkit.create(bytes);
}

async function parseFont(file: string, bytes: Uint8Array): Promise<Font> {
  const hit = parsedCache.get(file);
  if (hit) return hit;
  const created = fontkitCreate(bytes);
  const font = typeof (created as Promise<Font>).then === "function" ? await created : created;
  parsedCache.set(file, font);
  return font;
}

export function registerPdfFontkit(doc: PDFDocument): void {
  doc.registerFontkit(fontkit);
}

export async function loadBundledFontBytes(file: string): Promise<Uint8Array> {
  const cached = bytesCache.get(file);
  if (cached) return cached;

  let bytes: Uint8Array;
  if (typeof window === "undefined") {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    bytes = new Uint8Array(await readFile(join(process.cwd(), "public", "fonts", file)));
  } else {
    const base = import.meta.env.BASE_URL ?? "/";
    const prefix = base.endsWith("/") ? base : `${base}/`;
    const res = await fetch(`${prefix}fonts/${file}`);
    if (!res.ok) {
      throw new Error(`Could not load bundled font ${file} (${res.status}).`);
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  bytesCache.set(file, bytes);
  return bytes;
}

function missingInFont(font: Font, text: string): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const ch of foldPdfPunctuation(text)) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0x20) continue;
    if (font.hasGlyphForCodePoint(cp)) continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    missing.push(ch);
  }
  return missing;
}

function pickLiberation(match?: FontMatch): BundledFace {
  const bold = match?.bold ?? false;
  const italic = match?.italic ?? false;
  return (
    LIBERATION_SANS.find((face) => face.bold === bold && face.italic === italic) ??
    LIBERATION_SANS.find((face) => face.bold === bold && !face.italic) ??
    LIBERATION_SANS[0]!
  );
}

async function faceIfCovers(face: BundledFace, text: string): Promise<UnicodeFallbackFace | null> {
  const bytes = await loadBundledFontBytes(face.file);
  const font = await parseFont(face.file, bytes);
  if (missingInFont(font, text).length > 0) return null;
  return { file: face.file, label: face.label, bytes };
}

/**
 * Liberation Sans first (Helvetica metrics), then Noto Sans for leftover
 * Latin/Greek/Cyrillic. CJK and most symbols still come back as missing.
 */
export async function resolveUnicodeFallback(
  text: string,
  match?: FontMatch,
): Promise<UnicodeFallbackResult> {
  try {
    const liberation = await faceIfCovers(pickLiberation(match), text);
    if (liberation) return { ok: true, face: liberation };

    const noto = await faceIfCovers(NOTO_SANS, text);
    if (noto) return { ok: true, face: noto };

    const bytes = await loadBundledFontBytes(NOTO_SANS.file);
    const font = await parseFont(NOTO_SANS.file, bytes);
    return { ok: false, missing: missingInFont(font, text) };
  } catch {
    return { ok: false, missing: [...new Set([...foldPdfPunctuation(text)])] };
  }
}

export async function charsMissingFromBundledFonts(
  text: string,
  match?: FontMatch,
): Promise<string[]> {
  const result = await resolveUnicodeFallback(text, match);
  return result.ok ? [] : result.missing;
}

const embedCache = new WeakMap<PDFDocument, Map<string, PDFFont>>();

export async function embedUnicodeFallbackFont(
  doc: PDFDocument,
  face: UnicodeFallbackFace,
): Promise<PDFFont> {
  registerPdfFontkit(doc);
  let byFile = embedCache.get(doc);
  if (!byFile) {
    byFile = new Map();
    embedCache.set(doc, byFile);
  }
  const hit = byFile.get(face.file);
  if (hit) return hit;
  const font = await doc.embedFont(face.bytes, {
    subset: true,
    customName: face.label.replace(/\s+/g, ""),
  });
  byFile.set(face.file, font);
  return font;
}

export function bundledUnicodeCatalogLabel(match?: FontMatch): string {
  return pickLiberation(match).label;
}
