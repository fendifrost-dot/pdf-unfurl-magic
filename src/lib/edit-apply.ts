/**
 * Edit-page apply / Enhance-exit rules.
 * Keep these free of React so the P0 UX contracts can be unit-tested.
 */

export const APPLY_EDIT_LABEL = "Apply to page";

export const APPLY_SUCCESS_MESSAGE = "Applied. Export when you are done.";

export const ORIGINAL_UNCHANGED_HINT =
  "The original file is never changed until you Export a new PDF.";

export function pendingExportBanner(count: number): string {
  const noun = count === 1 ? "1 edit" : `${count} edits`;
  return `${noun} ready — Export to save a new PDF`;
}

export function ocrReadyNextStep(count: number): string {
  const noun = count === 1 ? "1 OCR line" : `${count} OCR lines`;
  return `${noun} ready. Click a line, edit it, Apply to page, then Export.`;
}

export function textPageFooter(input: {
  showingOcr: boolean;
  ocrLineCount: number;
  looksScanned: boolean;
  nativeLineCount: number;
  pendingTextEdits: number;
}): string {
  if (input.pendingTextEdits > 0) {
    return `${pendingExportBanner(input.pendingTextEdits)}. The original file is unchanged until you export.`;
  }
  if (input.showingOcr) {
    return ocrReadyNextStep(input.ocrLineCount);
  }
  if (input.ocrLineCount > 0) {
    const n = input.nativeLineCount;
    return `${n} text line${n === 1 ? "" : "s"} from the PDF. Enhance is closed — click a line to edit, or open Enhance for OCR boxes.`;
  }
  if (input.looksScanned) {
    return "This page looks scanned. Ghost boxes are not real text operators — use Enhance page & OCR in the side panel.";
  }
  const n = input.nativeLineCount;
  return `${n} text line${n === 1 ? "" : "s"} on this page. Click a row to edit the whole line; Shift-click a fragment for one run.`;
}

/** Text chip always leaves Enhance, including after OCR produced boxes. */
export function enhanceOpenAfterTextChip(): false {
  return false;
}

/**
 * Auto-open Enhance for scanned pages or #enhance.
 * After the user closes it (Text / Done), do not reopen just because OCR exists.
 */
export function nextEnhanceOpen(input: {
  userClosed: boolean;
  looksScanned: boolean;
  ocrLineCount: number;
  hashEnhance: boolean;
}): boolean {
  if (input.hashEnhance) return true;
  if (input.userClosed) return false;
  return input.looksScanned;
}

export function preferOcrOverlay(input: { enhanceOpen: boolean; ocrLineCount: number }): boolean {
  return input.enhanceOpen && input.ocrLineCount > 0;
}

/**
 * Apply-button / commit enablement. Priority:
 * 1. OCR lines (`selectedIsOcr` / `source === "ocr"`) always apply.
 * 2. Native ghost lines (`deferToScan` or no text operator) stay blocked.
 * 3. `scanMode` / false `looksScanned` must never disable Apply by themselves —
 *    `canCommitSafely` already returns false when `inspection.deferToScan`.
 */
export function canApplyTextEdit(input: {
  selectedIsOcr?: boolean | undefined;
  source?: "pdf" | "ocr" | "content-stream" | "pdfjs" | undefined;
  deferToScan?: boolean | undefined;
  canCommitSafely: boolean;
  looksScanned?: boolean | undefined;
  hasTextOperator?: boolean | undefined;
  /** Ignored. Kept so callers cannot accidentally reintroduce scanMode gating. */
  scanMode?: boolean | undefined;
}): boolean {
  void input.scanMode;
  if (input.selectedIsOcr || input.source === "ocr") return true;
  if (input.deferToScan) return false;
  if (input.looksScanned && input.hasTextOperator === false) return false;
  return input.canCommitSafely;
}

export function overlayApplyState(input: {
  lineId: string;
  originalText: string;
  appliedText?: string | undefined;
  selectedId: string | null;
  draft: string;
  memberIds?: string[] | undefined;
}): { isEdited: boolean; isLivePreview: boolean; displayText: string } {
  const isSelected =
    input.selectedId === input.lineId ||
    (!!input.selectedId && !!input.memberIds?.includes(input.selectedId));
  const applied = input.appliedText?.trim();
  const isEdited = !!applied && applied !== input.originalText;
  const live = isSelected ? input.draft.trim() : "";
  const isLivePreview = !!live && live !== (applied || input.originalText);
  return {
    isEdited,
    isLivePreview,
    displayText: isLivePreview ? input.draft : (applied ?? input.originalText),
  };
}

export const SHOW_EDIT_HIGHLIGHT_LABEL = "Show edit highlight";

export const MARK_CHANGES_FOR_REVIEWER_HINT = "Mark changes for reviewer";

export const EDIT_HIGHLIGHT_STORAGE_KEY = "pdf-relief-show-edit-highlight";

export type OverlayFillMode = "none" | "highlight";

const OVERLAY_BASE =
  "absolute min-h-[22px] cursor-text touch-manipulation overflow-hidden rounded-[2px] border text-left transition-colors [@media(pointer:fine)]:min-h-0";

/** Opaque / paper fills that cover watermarks. Default preview must not use these. */
const OPAQUE_OVERLAY_FILL = /\bbg-paper\b|\bbg-white\b|\bbg-background\b|\bbg-\[#fff|#ffffff/i;

export function overlayFillMode(input: {
  isEdited: boolean;
  isLivePreview: boolean;
  showHighlight: boolean;
}): OverlayFillMode {
  if (input.showHighlight && (input.isEdited || input.isLivePreview)) return "highlight";
  return "none";
}

export function overlayHasOpaqueFill(className: string): boolean {
  return OPAQUE_OVERLAY_FILL.test(className);
}

/**
 * Hit-target chrome for a text overlay. Default applied/preview text is
 * transparent (watermark shows through) with a thin outline when selected
 * and a soft green underline when applied. The reviewer toggle restores
 * the opaque paper slab.
 */
export function textOverlayChromeClass(input: {
  isSelected: boolean;
  isEdited: boolean;
  isLivePreview: boolean;
  showHighlight: boolean;
  source?: string | undefined;
  looksScanned?: boolean | undefined;
  showingOcr?: boolean | undefined;
}): string {
  const replaced = input.isLivePreview || input.isEdited;
  const fill = overlayFillMode(input);
  const parts = [OVERLAY_BASE];

  if (input.isSelected) {
    if (replaced) {
      parts.push(
        fill === "highlight"
          ? "border-success bg-paper text-foreground shadow-sm"
          : "border-primary bg-transparent text-foreground",
      );
    } else {
      parts.push("border-primary bg-primary/25");
    }
  } else if (replaced) {
    parts.push(
      fill === "highlight"
        ? "border-success bg-paper text-foreground shadow-sm"
        : "border-success/45 bg-transparent text-foreground shadow-[inset_0_-1.5px_0_0_color-mix(in_oklch,var(--success)_70%,transparent)]",
    );
  } else if (input.source === "ocr") {
    parts.push("border-dashed border-primary/55 bg-primary/10");
  } else if (input.looksScanned && !input.showingOcr) {
    parts.push("border-dashed border-warning/70 bg-warning/15");
  } else {
    parts.push(
      "border-primary/40 bg-primary/10 [@media(pointer:fine)]:border-transparent [@media(pointer:fine)]:bg-transparent [@media(pointer:fine)]:hover:border-primary/60 [@media(pointer:fine)]:hover:bg-primary/15",
    );
  }

  return parts.join(" ");
}

export function textOverlayLabelClass(fill: OverlayFillMode): string {
  return fill === "highlight"
    ? "block h-full w-full truncate px-0.5 font-medium leading-[1.15]"
    : "block h-full w-full truncate px-0.5 font-normal leading-[1.15]";
}

export function shouldFlattenPageAsScan(input: {
  hasOriginalJpeg: boolean;
  hasOcrEdits: boolean;
  replaceWithCleaned: boolean;
  hasNativeEdits: boolean;
  ocrLineCount: number;
}): boolean {
  if (input.hasNativeEdits) return false;
  return (
    input.hasOriginalJpeg &&
    (input.hasOcrEdits || input.replaceWithCleaned || input.ocrLineCount > 0)
  );
}
