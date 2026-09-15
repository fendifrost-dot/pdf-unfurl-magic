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

export function preferOcrOverlay(input: {
  enhanceOpen: boolean;
  ocrLineCount: number;
}): boolean {
  return input.enhanceOpen && input.ocrLineCount > 0;
}

export function canApplyTextEdit(input: {
  source?: "pdf" | "ocr" | "content-stream" | "pdfjs" | undefined;
  deferToScan?: boolean | undefined;
  canCommitSafely: boolean;
  looksScanned?: boolean | undefined;
  hasTextOperator?: boolean | undefined;
}): boolean {
  if (input.source === "ocr") return true;
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
