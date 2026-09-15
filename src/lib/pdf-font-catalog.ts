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

export function defaultFontChoiceId(
  catalog: CatalogFont[],
  selectedKey?: string,
  preferBundled = false,
): string {
  if (preferBundled) {
    const bundled = catalog.find(
      (item) => item.source === "bundled" && item.safety === "safe" && /liberation/i.test(item.id),
    );
    if (bundled) return bundled.id;
    const anyBundled = catalog.find((item) => item.source === "bundled" && item.safety === "safe");
    if (anyBundled) return anyBundled.id;
  }
  const embedded = selectedKey
    ? catalog.find((item) => item.resourceKey === selectedKey && item.safety === "safe")
    : catalog.find((item) => item.source === "embedded" && item.safety === "safe");
  return embedded?.id ?? catalog.find((item) => item.safety === "safe")?.id ?? catalog[0]?.id ?? "";
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
