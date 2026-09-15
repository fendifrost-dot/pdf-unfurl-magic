/**
 * Font picker catalog: embedded resources first, then local system fonts
 * (Electron / Chromium queryLocalFonts), then Standard 14 metric stand-ins.
 *
 * Safe vs Unsafe is about whether we can write the replacement without
 * “?” / .notdef — not about whether a run was found. We never ask for
 * Creative Cloud downloads and never ship a pirated font file.
 */

import { StandardFonts } from "pdf-lib";
import {
  charsMissingFromWinAnsi,
  isExactStandardBaseFont,
  isSymbolFontName,
  matchFont,
  metricFamilyFor,
  stripSubsetPrefix,
  type FontMatch,
} from "./pdf-font-match";

export type FontSource = "embedded" | "system" | "standard" | "bundled";
export type FontSafety = "safe" | "unsafe";

export type EmbeddedFontInfo = {
  key: string;
  baseFont: string;
  encoding: string;
  subset: boolean;
  standard: boolean;
  cid: boolean;
};

export type CatalogFont = {
  id: string;
  source: FontSource;
  label: string;
  family: string;
  postscriptName?: string;
  bold: boolean;
  italic: boolean;
  safety: FontSafety;
  reason: string;
  resourceKey?: string;
  baseFont?: string;
  standard?: StandardFonts;
  cid?: boolean;
  subset?: boolean;
  encoding?: string;
};

export type ClosestFontRank = "document" | "system" | "bundled" | "standard";

export type ClosestFontHint = {
  selectedKey?: string;
  fontName?: string;
  fontFamily?: string;
  baseFont?: string;
  draft?: string;
  originalText?: string;
};

export type ClosestFontSuggestion = {
  id: string;
  font: CatalogFont;
  rank: ClosestFontRank;
  reason: string;
  canEncode: boolean;
};

export type FontChoice = {
  source: FontSource;
  resourceKey?: string;
  family?: string;
  postscriptName?: string;
  /** Local font file bytes from queryLocalFonts().blob() — never a downloaded CC font. */
  embedBytes?: Uint8Array;
};

type LocalFontData = {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob: () => Promise<Blob>;
};

const CHROMIUM_STANDINS: Array<{ family: string; standard: StandardFonts; bold?: boolean }> = [
  { family: "Arial", standard: StandardFonts.Helvetica },
  { family: "Helvetica", standard: StandardFonts.Helvetica },
  { family: "Arial Bold", standard: StandardFonts.HelveticaBold, bold: true },
  { family: "Times New Roman", standard: StandardFonts.TimesRoman },
  { family: "Times", standard: StandardFonts.TimesRoman },
  { family: "Georgia", standard: StandardFonts.TimesRoman },
  { family: "Courier New", standard: StandardFonts.Courier },
  { family: "Courier", standard: StandardFonts.Courier },
  { family: "Verdana", standard: StandardFonts.Helvetica },
  { family: "Tahoma", standard: StandardFonts.Helvetica },
];

function looksBold(name: string): boolean {
  return /bold|black|heavy|semibold|demi/i.test(name);
}

function looksItalic(name: string): boolean {
  return /italic|oblique/i.test(name);
}

export function catalogEmbeddedFonts(
  fonts: EmbeddedFontInfo[],
  selectedKey?: string,
  originalText = "",
): CatalogFont[] {
  const items = [...fonts].sort((a, b) => {
    if (selectedKey && a.key === selectedKey) return -1;
    if (selectedKey && b.key === selectedKey) return 1;
    return a.baseFont.localeCompare(b.baseFont);
  });

  return items.map((info) => {
    const display = stripSubsetPrefix(info.baseFont) || info.key;
    const symbol = isSymbolFontName(info.baseFont);
    const exact = isExactStandardBaseFont(info.baseFont);
    let safety: FontSafety = "safe";
    let reason = `Reuses /${info.key} (${display}) already in this page.`;
    if (symbol) {
      safety = "unsafe";
      reason = "Symbol / dingbat font — replacement would write .notdef glyphs.";
    } else if (info.cid && info.subset) {
      reason = originalText
        ? `Embedded CID subset. Safe only for characters already in “${originalText}”. New glyphs use bundled Liberation/Noto — no Adobe Fonts purchase required.`
        : "Embedded CID subset. Safe only for glyphs already in this run. New glyphs use bundled Liberation/Noto — no Adobe Fonts purchase required.";
    } else if (info.subset) {
      reason =
        "Embedded subset. Safe for characters already in this run; new letters need a stand-in.";
    } else if (exact) {
      reason = `${display} is Standard 14 — already in the file, no extra font needed.`;
    }
    return {
      id: `embedded:${info.key}`,
      source: "embedded" as const,
      label: display,
      family: metricFamilyFor(info.baseFont),
      bold: looksBold(info.baseFont),
      italic: looksItalic(info.baseFont),
      safety,
      reason,
      resourceKey: info.key,
      baseFont: info.baseFont,
      cid: info.cid,
      subset: info.subset,
      encoding: info.encoding,
    };
  });
}

export function catalogBundledUnicodeFonts(match: FontMatch): CatalogFont[] {
  const bold = match.bold;
  const italic = match.italic;
  const label =
    bold && italic
      ? "Liberation Sans Bold Italic"
      : bold
        ? "Liberation Sans Bold"
        : italic
          ? "Liberation Sans Italic"
          : "Liberation Sans";
  return [
    {
      id: "bundled:liberation-sans",
      source: "bundled",
      label: `${label} (SIL OFL)`,
      family: "helvetica",
      bold,
      italic,
      safety: "safe",
      reason:
        "Bundled metric-compatible Helvetica stand-in (PRIOR_ART #1). Embedded as a subset when the original custom/CID/WinAnsi font cannot encode the text — never an Adobe Fonts download.",
    },
    {
      id: "bundled:noto-sans",
      source: "bundled",
      label: "Noto Sans (SIL OFL)",
      family: "helvetica",
      bold: false,
      italic: false,
      safety: "safe",
      reason:
        "Bundled Unicode fallback for Latin/Greek/Cyrillic beyond WinAnsi. Used automatically when Liberation lacks a glyph.",
    },
  ];
}

export function catalogStandardFallbacks(match: FontMatch): CatalogFont[] {
  return [
    {
      id: `standard:${match.standard}`,
      source: "standard",
      label: `${match.label} (Standard 14)`,
      family: match.family,
      bold: match.bold,
      italic: match.italic,
      safety: match.kind === "unsafe" ? "unsafe" : "safe",
      reason:
        match.kind === "unsafe"
          ? "Symbol stand-in is blocked."
          : `Metric-matched ${match.label}. Bundled Liberation/Noto is used when the original cannot be rewritten in place. No Adobe Fonts purchase required.`,
      standard: match.standard,
    },
  ];
}

export function catalogChromiumStandins(): CatalogFont[] {
  return CHROMIUM_STANDINS.map((item) => ({
    id: `system-approx:${item.family}`,
    source: "standard" as const,
    label: `${item.family} → ${item.standard}`,
    family: item.family,
    bold: !!item.bold,
    italic: false,
    safety: "safe" as const,
    reason: `No local file for ${item.family}. Will write the Standard 14 cousin (${item.standard}) — metrics only, not a pirated font.`,
    standard: item.standard,
  }));
}

export async function querySystemFonts(): Promise<LocalFontData[]> {
  const query = (globalThis as { queryLocalFonts?: () => Promise<LocalFontData[]> })
    .queryLocalFonts;
  if (typeof query !== "function") return [];
  try {
    return await query();
  } catch {
    return [];
  }
}

export function catalogSystemFonts(fonts: LocalFontData[]): CatalogFont[] {
  const seen = new Set<string>();
  const out: CatalogFont[] = [];
  for (const font of fonts) {
    const name = font.fullName || font.postscriptName || font.family;
    const id = `system:${font.postscriptName || name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const symbol = isSymbolFontName(name);
    out.push({
      id,
      source: "system",
      label: name,
      family: font.family,
      postscriptName: font.postscriptName,
      bold: looksBold(`${font.style} ${name}`),
      italic: looksItalic(`${font.style} ${name}`),
      safety: symbol ? "unsafe" : "safe",
      reason: symbol
        ? "Symbol font — blocked so we do not write “?”."
        : "Local system font already on this machine. Embedded on export if it can encode the text.",
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export async function loadSystemFontBytes(postscriptName: string): Promise<Uint8Array | null> {
  const fonts = await querySystemFonts();
  const hit = fonts.find((f) => f.postscriptName === postscriptName);
  if (!hit) return null;
  try {
    const blob = await hit.blob();
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

export function mergeFontCatalog(input: {
  embedded: EmbeddedFontInfo[];
  selectedKey?: string;
  originalText?: string;
  match: FontMatch;
  system?: LocalFontData[];
}): CatalogFont[] {
  const embedded = catalogEmbeddedFonts(
    input.embedded,
    input.selectedKey,
    input.originalText ?? "",
  );
  const system = input.system?.length
    ? catalogSystemFonts(input.system)
    : catalogChromiumStandins();
  const bundled = catalogBundledUnicodeFonts(input.match);
  const standard = catalogStandardFallbacks(input.match);
  const ids = new Set<string>();
  const out: CatalogFont[] = [];
  for (const item of [...embedded, ...system, ...bundled, ...standard]) {
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    out.push(item);
  }
  return out;
}

/** Acrobat-style face key: ignore subset tags, weight numbers, and Roman/R suffixes. */
export function compactFaceKey(name: string): string {
  return stripSubsetPrefix(name)
    .replace(/[,_+]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/mt$/i, "")
    .replace(/ps$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function fontFaceStem(name: string): string {
  const compact = compactFaceKey(name);
  const withoutNeueWeight = compact.replace(
    /\d{2}(roman|italic|oblique|medium|regular|bold|black|heavy|light|thin|it|md|bd|lt|r)?$/g,
    "",
  );
  return withoutNeueWeight.replace(
    /(bolditalic|boldoblique|italic|oblique|regular|bold|black|heavy|light|thin|medium)$/g,
    "",
  );
}

function hintNames(hint: ClosestFontHint): string[] {
  return [hint.baseFont, hint.fontName, hint.fontFamily, hint.selectedKey].filter(
    (value): value is string => !!value && value.trim().length > 0,
  );
}

function genericCssFamily(name: string): boolean {
  return /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace)$/i.test(
    name.trim(),
  );
}

export function catalogFontCanEncode(font: CatalogFont, draft: string, originalText = ""): boolean {
  if (font.safety !== "safe") return false;
  if (font.source === "bundled") return true;
  if (font.source === "system") return true;
  if (font.source === "standard") return charsMissingFromWinAnsi(draft).length === 0;
  if (font.cid || font.subset) {
    if (!draft) return true;
    const original = originalText || "";
    return [...draft].every((ch) => ch === " " || original.includes(ch));
  }
  return charsMissingFromWinAnsi(draft).length === 0;
}

function hintStems(hint: ClosestFontHint): string[] {
  const stems: string[] = [];
  const seen = new Set<string>();
  for (const name of hintNames(hint)) {
    if (genericCssFamily(name)) continue;
    const stem = fontFaceStem(name);
    if (stem.length < 4 || seen.has(stem)) continue;
    seen.add(stem);
    stems.push(stem);
  }
  return stems;
}

function documentNameScore(font: CatalogFont, hint: ClosestFontHint): number {
  if (hint.selectedKey && font.resourceKey === hint.selectedKey) return 10_000;
  const names = hintNames(hint).filter((name) => !genericCssFamily(name));
  const compactHints = names.map(compactFaceKey).filter((key) => key.length >= 4);
  const stems = hintStems(hint);
  const fontNames = [font.baseFont, font.label, font.postscriptName, font.resourceKey].filter(
    (value): value is string => !!value,
  );
  let best = 0;
  for (const name of fontNames) {
    const compact = compactFaceKey(name);
    const stem = fontFaceStem(name);
    if (compactHints.includes(compact) && compact.length >= 6) best = Math.max(best, 9_000);
    if (stems.includes(stem) && stem.length >= 6) best = Math.max(best, 8_000);
  }
  return best;
}

function systemTwinScore(font: CatalogFont, hint: ClosestFontHint): number {
  if (font.source !== "system" || font.safety !== "safe") return 0;
  const match = matchFont({
    fontName: hint.fontName,
    fontFamily: hint.fontFamily,
    baseFont: hint.baseFont,
  });
  const blob = hintNames(hint).join(" ").toLowerCase();
  const label = font.label.toLowerCase();
  const fontStem = fontFaceStem(font.postscriptName || font.label);
  const stems = hintStems(hint);
  if (
    stems.some(
      (stem) =>
        stem.length >= 6 &&
        (fontStem === stem || fontStem.includes(stem) || stem.includes(fontStem)),
    )
  ) {
    return 700;
  }
  const first = label.split(/[\s-]/)[0] ?? "";
  if (first.length >= 4 && blob.includes(first)) return 500;
  if (font.family === match.family && font.bold === match.bold) return 300;
  if (metricFamilyFor(font.label) === match.family && font.bold === match.bold) return 200;
  return 0;
}

function bundledScore(font: CatalogFont, hint: ClosestFontHint): number {
  if (font.source !== "bundled" || font.safety !== "safe") return 0;
  const match = matchFont({
    fontName: hint.fontName,
    fontFamily: hint.fontFamily,
    baseFont: hint.baseFont,
  });
  if (/liberation/i.test(font.id) && match.family === "helvetica") return 80;
  if (/liberation/i.test(font.id) && match.family === "times") return 40;
  if (/noto/i.test(font.id)) return 20;
  return 10;
}

function rankFor(font: CatalogFont): ClosestFontRank {
  if (font.source === "embedded") return "document";
  if (font.source === "system") return "system";
  if (font.source === "bundled") return "bundled";
  return "standard";
}

export function describeClosestFontMatch(
  suggestion: Pick<ClosestFontSuggestion, "font" | "rank" | "canEncode">,
  hint: ClosestFontHint = {},
): string {
  const label = suggestion.font.label;
  const origin = stripSubsetPrefix(hint.baseFont || hint.fontName || "") || "the original face";
  if (suggestion.rank === "document") {
    const cid = suggestion.font.cid ? " (CID)" : "";
    return `Closest match: ${label}${cid} — this page’s own face.`;
  }
  if (suggestion.rank === "system") {
    return `Closest match: ${label} — local metric twin of ${origin}.`;
  }
  if (suggestion.rank === "bundled") {
    return `Closest match: ${label} — bundled stand-in because the original face cannot encode this draft.`;
  }
  return `Closest match: ${label} — Standard 14 metric stand-in.`;
}

function finishSuggestion(
  font: CatalogFont,
  hint: ClosestFontHint,
  canEncode: boolean,
): ClosestFontSuggestion {
  const rank = rankFor(font);
  return {
    id: font.id,
    font,
    rank,
    canEncode,
    reason: describeClosestFontMatch({ font, rank, canEncode }, hint),
  };
}

/**
 * Acrobat-style picker default: document face → system metric twin →
 * bundled Liberation/Noto only when those cannot encode the draft.
 */
export function suggestClosestFont(
  catalog: CatalogFont[],
  hint: ClosestFontHint = {},
): ClosestFontSuggestion | undefined {
  const draft = hint.draft ?? hint.originalText ?? "";
  const originalText = hint.originalText ?? "";
  const safe = catalog.filter((item) => item.safety === "safe");
  if (safe.length === 0) {
    const first = catalog[0];
    if (!first) return undefined;
    return finishSuggestion(first, hint, false);
  }

  const scored = safe.map((font) => {
    const canEncode = catalogFontCanEncode(font, draft, originalText);
    const documentScore = font.source === "embedded" ? documentNameScore(font, hint) : 0;
    const systemScore = systemTwinScore(font, hint);
    const bundleScore = bundledScore(font, hint);
    const standardScore =
      font.source === "standard" && canEncode ? 15 : font.source === "standard" ? 5 : 0;
    const sourceBias =
      font.source === "embedded"
        ? 4
        : font.source === "system"
          ? 3
          : font.source === "bundled"
            ? 2
            : 1;
    const total =
      documentScore * 10 +
      systemScore * 10 +
      bundleScore * 10 +
      standardScore +
      sourceBias +
      (canEncode ? 1 : 0);
    return { font, canEncode, documentScore, systemScore, bundleScore, total };
  });

  scored.sort((a, b) => b.total - a.total || a.font.label.localeCompare(b.font.label));

  const documentHit = scored.find((item) => item.documentScore >= 8_000 && item.canEncode);
  if (documentHit) return finishSuggestion(documentHit.font, hint, documentHit.canEncode);

  const safeDocumentFace = scored.find(
    (item) => item.font.source === "embedded" && item.documentScore >= 8_000,
  );
  if (
    safeDocumentFace &&
    (safeDocumentFace.canEncode || safeDocumentFace.font.cid || safeDocumentFace.font.subset)
  ) {
    return finishSuggestion(safeDocumentFace.font, hint, safeDocumentFace.canEncode);
  }

  const systemHit = scored.find((item) => item.systemScore > 0 && item.canEncode);
  if (systemHit) return finishSuggestion(systemHit.font, hint, systemHit.canEncode);

  const bundledHit =
    scored.find((item) => item.font.source === "bundled" && /liberation/i.test(item.font.id)) ??
    scored.find((item) => item.font.source === "bundled");
  if (bundledHit) return finishSuggestion(bundledHit.font, hint, bundledHit.canEncode);

  const bestEncodable = scored.find((item) => item.canEncode);
  const pick = bestEncodable ?? scored[0];
  if (!pick) return undefined;
  return finishSuggestion(pick.font, hint, pick.canEncode);
}

export function defaultFontChoiceId(
  catalog: CatalogFont[],
  selectedKey?: string,
  preferBundled = false,
  hint: ClosestFontHint = {},
): string {
  const merged: ClosestFontHint = { ...hint, selectedKey: hint.selectedKey ?? selectedKey };
  const suggestion = suggestClosestFont(catalog, merged);
  if (suggestion) {
    if (preferBundled && suggestion.rank !== "document" && suggestion.rank !== "system") {
      const bundled = catalog.find(
        (item) =>
          item.source === "bundled" && item.safety === "safe" && /liberation/i.test(item.id),
      );
      if (bundled) return bundled.id;
    }
    return suggestion.id;
  }
  return catalog.find((item) => item.safety === "safe")?.id ?? catalog[0]?.id ?? "";
}

export function matchSystemFontToMetrics(
  fonts: CatalogFont[],
  hint: { fontName?: string; fontFamily?: string; baseFont?: string },
): CatalogFont | undefined {
  const match = matchFont(hint);
  const blob =
    `${hint.baseFont ?? ""} ${hint.fontName ?? ""} ${hint.fontFamily ?? ""}`.toLowerCase();
  return fonts.find((font) => {
    if (font.safety !== "safe") return false;
    if (font.source !== "system") return false;
    const label = font.label.toLowerCase();
    if (blob && label && blob.includes(label.split(" ")[0] ?? "")) return true;
    if (font.family === match.family && font.bold === match.bold) return true;
    return false;
  });
}
