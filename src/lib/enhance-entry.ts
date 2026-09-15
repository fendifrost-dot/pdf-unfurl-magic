/**
 * Copy and open-state for the Edit → Enhance / OCR entry.
 * The control is always on the Text sidebar; auto-detect only decides
 * whether it starts expanded, not whether it exists.
 */

export const ENHANCE_TRIGGER_LABEL = "Enhance & OCR this page";

export const ENHANCE_CHIP_LABEL = "Enhance";

export function shouldAutoExpandEnhance(input: {
  looksScanned: boolean;
  ocrLineCount: number;
}): boolean {
  return input.looksScanned || input.ocrLineCount > 0;
}

export function enhanceEntryCopy(looksScanned: boolean): { title: string; body: string } {
  if (looksScanned) {
    return {
      title: "This page looks scanned",
      body: "Enhance this page and OCR to edit amounts without painting Helvetica over the image.",
    };
  }
  return {
    title: "Optional — enhance this page",
    body: "Optional — use when the page is a scan, blurry, or text picking is wrong. For a clean digital PDF you can ignore this. Nothing runs until you choose Enhance page & OCR.",
  };
}
