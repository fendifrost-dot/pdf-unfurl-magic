/**
 * Edit-page apply / Enhance-exit rules.
 * Keep these free of React so the P0 UX contracts can be unit-tested.
 */

import {
  clusterBoxesByColumn,
  looksLikeAmountText,
  looksLikeMoneyColumn,
  splitDraftAcrossColumns,
  splitDraftAcrossRuns,
  type TextPatchMember,
} from "./pdf-text-edit";
import { visualRowBands } from "./text-select";

export const APPLY_EDIT_LABEL = "Apply to page";

export const APPLY_SUCCESS_MESSAGE =
  "Applied on this page (session only). Save As… when you want a new PDF.";

export const ORIGINAL_UNCHANGED_HINT =
  "Apply never writes a file. Save As… always creates a new PDF and never overwrites the one you opened.";

export function pendingExportBanner(count: number): string {
  const noun = count === 1 ? "1 edit" : `${count} edits`;
  return `${noun} ready — Save As… to write a new PDF`;
}

export function ocrReadyNextStep(count: number): string {
  const noun = count === 1 ? "1 OCR line" : `${count} OCR lines`;
  return `${noun} ready. Verify uncertain glyphs first, then click a line, edit it, Apply to page, then Save As….`;
}

export function textPageFooter(input: {
  showingOcr: boolean;
  ocrLineCount: number;
  looksScanned: boolean;
  nativeLineCount: number;
  pendingTextEdits: number;
}): string {
  if (input.pendingTextEdits > 0) {
    return `${pendingExportBanner(input.pendingTextEdits)}. The original file is unchanged until you Save As….`;
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

export const LEAVE_ENHANCE_LABEL = "Leave Enhance";

/**
 * Text pick (Line / Select any) stays on the Edit chrome in Text mode —
 * including while Enhance / OCR is open. Hiding it after OCR is the trap:
 * users cannot return to click-to-edit without an export round-trip.
 */
export function textPickVisible(mode: string): boolean {
  return mode === "text";
}

/**
 * Auto-open Enhance for scanned pages or #enhance.
 * After the user closes it (Text / Done / Line / Select any / Clear OCR),
 * do not reopen because OCR exists, looksScanned is still true, or the
 * URL still has #enhance.
 */
export function nextEnhanceOpen(input: {
  userClosed: boolean;
  looksScanned: boolean;
  ocrLineCount: number;
  hashEnhance: boolean;
}): boolean {
  void input.ocrLineCount;
  if (input.userClosed) return false;
  if (input.hashEnhance) return true;
  return input.looksScanned;
}

export function preferOcrOverlay(input: {
  enhanceOpen: boolean;
  ocrLineCount: number;
  /** Native PDF.js / content-stream lines already on the page. */
  nativeLineCount?: number | undefined;
  looksScanned?: boolean | undefined;
}): boolean {
  if (!input.enhanceOpen || input.ocrLineCount <= 0) return false;
  // Digital text (bank statements, native PDFs) must stay click-to-edit
  // after Enhance & OCR. OCR boxes live in the side panel until the page
  // has no native lines (true scan) or auto-detect says scanned (ghost).
  if ((input.nativeLineCount ?? 0) > 0 && !input.looksScanned) return false;
  return true;
}

/** Overlay source after leaving Enhance, or while Enhance is open on native text. */
export function linesForTextEdit<T>(input: {
  enhanceOpen: boolean;
  ocrLines: T[];
  nativeLines: T[];
  looksScanned?: boolean | undefined;
}): T[] {
  if (
    preferOcrOverlay({
      enhanceOpen: input.enhanceOpen,
      ocrLineCount: input.ocrLines.length,
      nativeLineCount: input.nativeLines.length,
      looksScanned: input.looksScanned,
    })
  ) {
    return input.ocrLines.length ? input.ocrLines : input.nativeLines;
  }
  return input.nativeLines.length ? input.nativeLines : input.ocrLines;
}

export function emptySelectionCopy(input: {
  showingOcr: boolean;
  ocrLineCount: number;
  pendingVerify: number;
  hasDoc: boolean;
  lineCount: number;
  textSelectMode: "line" | "marquee";
}): { title: string; body: string } {
  if (input.lineCount === 0 && input.hasDoc) {
    return {
      title: "No text operators on this page",
      body: "Use Enhance & OCR this page when this is a scan or the picture is hard to read. A Safe edit here would paint over the image.",
    };
  }
  if (input.showingOcr) {
    return {
      title: "Nothing selected",
      body:
        input.pendingVerify > 0
          ? "Verify uncertain OCR above, then click a confirmed line."
          : "Click an OCR line above or a box on the page. Leave Enhance to edit native PDF lines.",
    };
  }
  void input.ocrLineCount;
  return {
    title: "Nothing selected",
    body:
      input.textSelectMode === "marquee"
        ? "Drag a rectangle across any text runs or several statement rows, then edit each selected row in the chunk editor."
        : "Click any line on the page to open it here, or switch to Image studio. Enhance is optional if picking feels wrong.",
  };
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
  /** Uncertain OCR snippets must be accepted, corrected, or skipped first. */
  ocrVerifyPending?: boolean | undefined;
}): boolean {
  void input.scanMode;
  if (input.ocrVerifyPending) return false;
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

/**
 * After Apply, the canvas is re-rendered from the rewritten PDF so the new
 * glyphs match neighbouring lines. Overlay text is then only needed for a live
 * draft, a reviewer highlight box, or when the canvas could not be patched.
 *
 * Never paint OCR/string labels on top of a still-visible native PDF.js
 * canvas — hit-targets stay `sr-only`. Position-only drift (`isMoved`) is not
 * a text edit and must not be passed as `isEdited`.
 */
export function overlayShouldPaintLabel(input: {
  isEdited: boolean;
  isLivePreview: boolean;
  showHighlight: boolean;
  canvasShowsApplied: boolean;
  /** PDF.js / patched canvas is showing live native glyphs. */
  nativeCanvasVisible?: boolean | undefined;
  source?: string | undefined;
}): boolean {
  const overNative = input.nativeCanvasVisible !== false;
  if (overNative && input.source === "ocr") return false;
  if (overNative && !input.isLivePreview && !input.isEdited) return false;
  if (input.isLivePreview) return true;
  if (!input.isEdited) return false;
  if (input.showHighlight) return true;
  return !input.canvasShowsApplied;
}

/**
 * Edit page compositing: native PDF.js canvas vs enhanced JPEG preview.
 * These two must be mutually exclusive — never stack a cleaned bitmap on a
 * still-visible text canvas. Digital (non-scan) pages keep the native canvas
 * even if Enhance produced a JPEG or `replaceWithCleaned` was toggled.
 */
export function editPreviewLayers(input: {
  looksScanned: boolean;
  nativeLineCount: number;
  replaceWithCleaned: boolean;
  hasEnhancedPreview: boolean;
}): {
  showNativeCanvas: boolean;
  showEnhancedBitmap: boolean;
} {
  const digitalNative = input.nativeLineCount > 0 && !input.looksScanned;
  const showEnhancedBitmap = input.hasEnhancedPreview && input.replaceWithCleaned && !digitalNative;
  return {
    showEnhancedBitmap,
    showNativeCanvas: !showEnhancedBitmap,
  };
}

/** True when the Edit preview would show two copies of the same glyphs. */
export function editPreviewWouldDoublePaint(input: {
  showNativeCanvas: boolean;
  showEnhancedBitmap: boolean;
  paintVisibleOverlayLabel: boolean;
}): boolean {
  if (!input.showNativeCanvas) return false;
  return input.showEnhancedBitmap || input.paintVisibleOverlayLabel;
}

/**
 * Full Edit preview path for one overlay line — the compositing + label
 * decision `edit.tsx` must follow so digital pages never stack.
 */
export function resolveEditPreview(input: {
  looksScanned: boolean;
  nativeLineCount: number;
  replaceWithCleaned: boolean;
  hasEnhancedPreview: boolean;
  enhanceOpen: boolean;
  ocrLineCount: number;
  line: {
    source?: string | undefined;
    textChanged: boolean;
    isLivePreview: boolean;
    /** Extract-time PDF.js vs stream Y, or a user nudge. Not a text edit. */
    isMoved?: boolean | undefined;
    showHighlight: boolean;
    canvasShowsApplied: boolean;
  };
}): {
  showNativeCanvas: boolean;
  showEnhancedBitmap: boolean;
  paintVisibleOverlayLabel: boolean;
} {
  void input.line.isMoved;
  const layers = editPreviewLayers({
    looksScanned: input.looksScanned,
    nativeLineCount: input.nativeLineCount,
    replaceWithCleaned: input.replaceWithCleaned,
    hasEnhancedPreview: input.hasEnhancedPreview,
  });
  const showingOcr = preferOcrOverlay({
    enhanceOpen: input.enhanceOpen,
    ocrLineCount: input.ocrLineCount,
    nativeLineCount: input.nativeLineCount,
    looksScanned: input.looksScanned,
  });
  const paintVisibleOverlayLabel = overlayShouldPaintLabel({
    isEdited: input.line.textChanged,
    isLivePreview: input.line.isLivePreview,
    showHighlight: input.line.showHighlight,
    canvasShowsApplied: input.line.canvasShowsApplied,
    nativeCanvasVisible: layers.showNativeCanvas,
    source: showingOcr ? "ocr" : input.line.source,
  });
  return { ...layers, paintVisibleOverlayLabel };
}

export function shouldFlattenPageAsScan(input: {
  hasOriginalJpeg: boolean;
  hasOcrEdits: boolean;
  replaceWithCleaned: boolean;
  hasNativeEdits: boolean;
  ocrLineCount: number;
  looksScanned?: boolean;
}): boolean {
  if (input.hasNativeEdits) return false;
  if (!input.hasOriginalJpeg) return false;
  if (input.replaceWithCleaned || input.hasOcrEdits) return true;
  return input.ocrLineCount > 0 && input.looksScanned === true;
}

export type ColumnField = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  fontFamily: string;
  text: string;
  rawText?: string;
  runs: Array<{
    id: string;
    x: number;
    y: number;
    originX?: number;
    originY?: number;
    width: number;
    height: number;
    fontSize: number;
    fontName: string;
    fontFamily: string;
    text: string;
    rawText?: string;
    originX?: number;
    originY?: number;
  }>;
};

type LineLike = {
  id: string;
  x: number;
  y: number;
  originX?: number;
  originY?: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  fontFamily: string;
  text: string;
  rawText?: string;
  members?: ColumnField["runs"];
};

const POSITION_EPS = 0.05;

function locateX(run: { x: number; originX?: number }): number {
  return run.originX ?? run.x;
}

function locateY(run: { y: number; originY?: number }): number {
  return run.originY ?? run.y;
}

function destFields(run: {
  x: number;
  y: number;
  originX?: number;
  originY?: number;
}): Pick<TextPatchMember, "targetX" | "targetY"> {
  const originX = locateX(run);
  const originY = locateY(run);
  return {
    ...(Math.abs(run.x - originX) > POSITION_EPS ? { targetX: run.x } : {}),
    ...(Math.abs(run.y - originY) > POSITION_EPS ? { targetY: run.y } : {}),
  };
}

function clusterRunsByExtractColumn<
  T extends {
    id: string;
    x: number;
    width: number;
    fontSize?: number;
    text?: string;
    originX?: number;
  },
>(runs: T[]): T[][] {
  const keyed = runs.map((run) => ({ ...run, x: locateX(run) }));
  return clusterBoxesByColumn(keyed).map((group) =>
    group.map((item) => runs.find((run) => run.id === item.id) ?? (item as T)),
  );
}

function patchMemberFromRun(run: ColumnField["runs"][number], text: string): TextPatchMember {
  return {
    x: locateX(run),
    y: locateY(run),
    width: run.width,
    height: run.height,
    fontSize: run.fontSize,
    fontName: run.fontName,
    fontFamily: run.fontFamily,
    text,
    originalText: run.text,
    ...(run.rawText ? { rawText: run.rawText } : {}),
    ...destFields(run),
  };
}

/** True when a clustered run is currency — including `250.00-` and `(250.00)`. */
function groupLooksLikeAmount(groupText: string): boolean {
  if (looksLikeMoneyColumn(groupText) || looksLikeAmountText(groupText)) return true;
  const tokens = groupText.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => looksLikeAmountText(token));
}

export function memberColumnLabel(groupText: string, index: number, groupTexts: string[]): string {
  const tokens = groupText.trim().split(/\s+/).filter(Boolean);
  const amountLike = groupLooksLikeAmount(groupText);
  if (amountLike) {
    if (tokens.length > 1 && tokens.every((token) => looksLikeAmountText(token))) {
      return "Amount / Balance";
    }
    const amountIndexes = groupTexts
      .map((text, i) => (groupLooksLikeAmount(text) ? i : -1))
      .filter((i) => i >= 0);
    const lastAmount = amountIndexes[amountIndexes.length - 1];
    // Two money columns, or a 3-column statement row: rightmost money is Balance.
    if (
      index === lastAmount &&
      (amountIndexes.length > 1 || (groupTexts.length >= 3 && lastAmount !== 0))
    ) {
      return "Balance";
    }
    return "Amount";
  }
  if (index === 0) return "Description";
  return `Column ${index + 1}`;
}

function trimmedMembers(line: LineLike): ColumnField["runs"] {
  return (line.members?.length ? line.members : []).filter((run) => run.text.trim());
}

function lineFromBand(parent: LineLike, band: ColumnField["runs"]): LineLike {
  const sorted = [...band].sort((a, b) => locateX(a) - locateX(b));
  const first = sorted[0]!;
  const x = Math.min(...sorted.map((run) => locateX(run)));
  const y = Math.min(...sorted.map((run) => locateY(run)));
  const right = Math.max(...sorted.map((run) => locateX(run) + run.width));
  const top = Math.max(...sorted.map((run) => locateY(run) + run.height));
  const fontSize = Math.max(...sorted.map((run) => run.fontSize));
  const text = sorted
    .map((run) => run.text)
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .trim();
  return {
    id: `${parent.id}-y${Math.round(y)}`,
    x,
    y,
    originX: x,
    originY: y,
    width: Math.max(right - x, fontSize * 0.6),
    height: Math.max(top - y, fontSize * 1.18),
    fontSize,
    fontName: first.fontName,
    fontFamily: first.fontFamily,
    text,
    members: sorted,
  };
}

/** Split a joined marquee / multi-run selection into one line per visual row. */
export function visualRowsForLine(line: LineLike): LineLike[] {
  const members = trimmedMembers(line);
  if (members.length < 2) return [line];
  const bands = visualRowBands(members);
  if (bands.length <= 1) return [line];
  return bands.map((band) => lineFromBand(line, band));
}

export function isChunkSelection(line: LineLike): boolean {
  return visualRowsForLine(line).length > 1;
}

export function runCountForLine(line: LineLike): number {
  const members = trimmedMembers(line);
  return Math.max(members.length, 1);
}

export type ChunkRow = {
  id: string;
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  fontFamily: string;
  fields: ColumnField[];
  runCount: number;
};

export function chunkRowsForSelection(line: LineLike): ChunkRow[] {
  return visualRowsForLine(line).map((row, index) => {
    const fields = columnFieldsForLine(row);
    const members = trimmedMembers(row);
    return {
      id: row.id,
      index,
      text: row.text,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      fontSize: row.fontSize,
      fontName: row.fontName,
      fontFamily: row.fontFamily,
      fields,
      runCount: Math.max(members.length, 1),
    };
  });
}

export function seedChunkDrafts(
  rows: ChunkRow[],
  stored?: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const row of rows) {
    if (row.fields.length > 1) {
      for (const field of row.fields) {
        next[field.id] = stored?.[field.id] ?? field.text;
      }
    } else {
      next[row.id] = stored?.[row.id] ?? row.text;
    }
  }
  return next;
}

export function joinChunkDrafts(rows: ChunkRow[], drafts: Record<string, string>): string {
  return rows
    .map((row) =>
      row.fields.length > 1
        ? joinColumnDrafts(row.fields, drafts)
        : (drafts[row.id] ?? row.text).trim(),
    )
    .filter((text) => text.length > 0)
    .join("\n");
}

export function collectChunkMemberTexts(
  rows: ChunkRow[],
  drafts: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const row of rows) {
    if (row.fields.length > 1) {
      for (const field of row.fields) {
        next[field.id] = drafts[field.id] ?? field.text;
      }
    } else {
      next[row.id] = drafts[row.id] ?? row.text;
    }
  }
  return next;
}

export function selectionEditTitle(input: {
  selectedIsOcr?: boolean;
  editingRun?: boolean;
  rowCount: number;
  runCount: number;
}): string {
  if (input.selectedIsOcr) {
    return input.rowCount > 1 ? `Editing ${input.rowCount} OCR lines` : "Editing one OCR line";
  }
  if (input.rowCount > 1) {
    return `Editing ${input.rowCount} lines / ${input.runCount} runs`;
  }
  if (input.editingRun) return "Editing one run";
  return "Editing one line";
}

export function columnFieldsForLine(line: LineLike): ColumnField[] {
  const members = trimmedMembers(line);
  if (members.length < 2) return [];
  // Never cluster amount columns down a page — that mashes 1 357 22 2 744 into one field.
  if (visualRowBands(members).length > 1) return [];
  const groups = clusterRunsByExtractColumn(members);
  if (groups.length < 2) return [];
  const texts = groups.map((group) =>
    group
      .map((run) => run.text)
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim(),
  );
  return groups.map((group, index) => {
    const first = group[0]!;
    const x = Math.min(...group.map((run) => locateX(run)));
    const right = Math.max(...group.map((run) => locateX(run) + run.width));
    return {
      id: first.id,
      label: memberColumnLabel(texts[index] ?? "", index, texts),
      x,
      y: Math.min(...group.map((run) => locateY(run))),
      width: Math.max(right - x, first.fontSize * 0.6),
      height: Math.max(...group.map((run) => run.height)),
      fontSize: Math.max(...group.map((run) => run.fontSize)),
      fontName: first.fontName,
      fontFamily: first.fontFamily,
      text: texts[index] ?? "",
      ...(first.rawText ? { rawText: first.rawText } : {}),
      runs: group,
    };
  });
}

export function isColumnarLine(line: LineLike): boolean {
  return columnFieldsForLine(line).length > 1;
}

export function joinColumnDrafts(fields: ColumnField[], drafts: Record<string, string>): string {
  return fields
    .map((field) => (drafts[field.id] ?? field.text).trim())
    .filter((text) => text.length > 0)
    .join(" ");
}

/**
 * Carry description (or per-column) drafts onto a newly joined full line.
 * Matches columns by id, then x, then label so Amount/Balance stay original.
 */
export function remapColumnMemberTexts(input: {
  fromFields: ColumnField[];
  toFields: ColumnField[];
  memberTexts?: Record<string, string>;
  liveDrafts?: Record<string, string>;
  sourceDraft?: string;
  sourceWasColumnar: boolean;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const to of input.toFields) {
    const from =
      input.fromFields.find((field) => field.id === to.id) ??
      input.fromFields.find((field) => Math.abs(field.x - to.x) <= 8) ??
      input.fromFields.find(
        (field) => field.label === to.label && field.label !== "Amount / Balance",
      );
    const live = from ? input.liveDrafts?.[from.id] : undefined;
    const stored = from ? input.memberTexts?.[from.id] : undefined;
    out[to.id] = (live ?? stored ?? to.text).trim() || to.text;
  }
  if (!input.sourceWasColumnar && input.sourceDraft?.trim()) {
    const desc = input.toFields.find((field) => field.label === "Description") ?? input.toFields[0];
    if (desc) out[desc.id] = input.sourceDraft.trim();
  }
  return out;
}

function membersForSingleRowPatch(
  line: LineLike,
  drafts?: Record<string, string>,
  forceMembers = false,
): TextPatchMember[] | undefined {
  const fields = columnFieldsForLine(line);
  if (fields.length < 2) {
    const runs = line.members?.length ? line.members : [];
    if (runs.length <= 1) {
      const run = runs[0];
      if (!run) return undefined;
      const next = drafts?.[run.id] ?? drafts?.[line.id] ?? run.text;
      if (!forceMembers && next === run.text) return undefined;
      return [patchMemberFromRun(run, next)];
    }
    const next = drafts?.[line.id] ?? line.text;
    const parts = splitDraftAcrossRuns(
      runs.map((run) => ({ text: run.text })),
      next,
    );
    return runs.map((run, index) => patchMemberFromRun(run, parts[index] ?? ""));
  }
  const members: TextPatchMember[] = [];
  const hasFieldDrafts = fields.some((field) => drafts?.[field.id] !== undefined);
  const columnDrafts = hasFieldDrafts
    ? fields.map((field) => drafts?.[field.id] ?? field.text)
    : splitDraftAcrossColumns(
        fields.map((field) => ({ text: field.text })),
        drafts?.[line.id] ?? line.text,
      );
  fields.forEach((field, fieldIndex) => {
    const next = columnDrafts[fieldIndex] ?? field.text;
    const parts = splitDraftAcrossRuns(
      field.runs.map((run) => ({ text: run.text })),
      next,
    );
    field.runs.forEach((run, index) => {
      members.push(patchMemberFromRun(run, parts[index] ?? ""));
    });
  });
  return members;
}

export function membersForLinePatch(
  line: LineLike,
  drafts?: Record<string, string>,
): TextPatchMember[] | undefined {
  const rows = visualRowsForLine(line);
  if (rows.length > 1) {
    const members: TextPatchMember[] = [];
    for (const row of rows) {
      const parts = membersForSingleRowPatch(row, drafts, true);
      if (parts) members.push(...parts);
    }
    return members.length ? members : undefined;
  }
  return membersForSingleRowPatch(line, drafts);
}
