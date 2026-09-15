import { StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { canCommitSafely, type TextEditInspection } from "./pdf-text-edit";
import {
  APPLY_EDIT_LABEL,
  APPLY_SUCCESS_MESSAGE,
  canApplyTextEdit,
  enhanceOpenAfterTextChip,
  nextEnhanceOpen,
  ocrReadyNextStep,
  overlayApplyState,
  pendingExportBanner,
  preferOcrOverlay,
  shouldFlattenPageAsScan,
  textPageFooter,
} from "./edit-apply";

const safeInspection: TextEditInspection = {
  found: true,
  method: "in-place",
  fontMatch: {
    kind: "embedded-standard",
    standard: StandardFonts.Helvetica,
    label: "Helvetica",
    family: "helvetica",
    bold: false,
    italic: false,
  },
  fontLabel: "Helvetica",
  missingGlyphs: [],
  message: "ok",
};

describe("Apply / Enhance exit contracts", () => {
  it("Text chip closes Enhance even when ocrLineCount > 0", () => {
    expect(enhanceOpenAfterTextChip()).toBe(false);
    expect(
      nextEnhanceOpen({
        userClosed: true,
        looksScanned: false,
        ocrLineCount: 125,
        hashEnhance: false,
      }),
    ).toBe(false);
    expect(
      nextEnhanceOpen({
        userClosed: true,
        looksScanned: true,
        ocrLineCount: 125,
        hashEnhance: false,
      }),
    ).toBe(false);
  });

  it("does not auto-reopen Enhance solely because an OCR session exists", () => {
    expect(
      nextEnhanceOpen({
        userClosed: false,
        looksScanned: false,
        ocrLineCount: 12,
        hashEnhance: false,
      }),
    ).toBe(false);
    expect(
      nextEnhanceOpen({
        userClosed: false,
        looksScanned: true,
        ocrLineCount: 0,
        hashEnhance: false,
      }),
    ).toBe(true);
  });

  it("enables commit for OCR lines even when a scan/OCR session is active", () => {
    expect(
      canApplyTextEdit({
        source: "ocr",
        deferToScan: true,
        canCommitSafely: false,
        looksScanned: true,
      }),
    ).toBe(true);
  });

  it("does not block native lines solely because OCR exists — only ghost / deferToScan", () => {
    expect(
      canApplyTextEdit({
        source: "pdfjs",
        deferToScan: false,
        canCommitSafely: canCommitSafely(safeInspection, "Paid From", "Paid To"),
        looksScanned: false,
      }),
    ).toBe(true);
    expect(
      canApplyTextEdit({
        source: "pdf",
        deferToScan: true,
        canCommitSafely: true,
        looksScanned: true,
      }),
    ).toBe(false);
    expect(
      canApplyTextEdit({
        source: "content-stream",
        deferToScan: false,
        canCommitSafely: true,
        looksScanned: true,
        hasTextOperator: false,
      }),
    ).toBe(false);
  });

  it("apply updates overlay edited flag and display text", () => {
    const before = overlayApplyState({
      lineId: "line-1",
      originalText: "Paid To",
      selectedId: "line-1",
      draft: "Paid From",
    });
    expect(before.isEdited).toBe(false);
    expect(before.isLivePreview).toBe(true);
    expect(before.displayText).toBe("Paid From");

    const after = overlayApplyState({
      lineId: "line-1",
      originalText: "Paid To",
      appliedText: "Paid From",
      selectedId: "line-1",
      draft: "Paid From",
    });
    expect(after.isEdited).toBe(true);
    expect(after.isLivePreview).toBe(false);
    expect(after.displayText).toBe("Paid From");
  });

  it("hides OCR boxes when Enhance is closed", () => {
    expect(preferOcrOverlay({ enhanceOpen: true, ocrLineCount: 125 })).toBe(true);
    expect(preferOcrOverlay({ enhanceOpen: false, ocrLineCount: 125 })).toBe(false);
  });

  it("does not flatten a page as a scan when native edits exist", () => {
    expect(
      shouldFlattenPageAsScan({
        hasOriginalJpeg: true,
        hasOcrEdits: false,
        replaceWithCleaned: false,
        hasNativeEdits: true,
        ocrLineCount: 125,
      }),
    ).toBe(false);
    expect(
      shouldFlattenPageAsScan({
        hasOriginalJpeg: true,
        hasOcrEdits: true,
        replaceWithCleaned: false,
        hasNativeEdits: false,
        ocrLineCount: 125,
      }),
    ).toBe(true);
  });

  it("uses Apply language in banners and the primary label", () => {
    expect(APPLY_EDIT_LABEL).toBe("Apply to page");
    expect(APPLY_SUCCESS_MESSAGE).toMatch(/applied/i);
    expect(pendingExportBanner(1)).toBe("1 edit ready — Export to save a new PDF");
    expect(ocrReadyNextStep(125)).toMatch(/Apply to page/);
    expect(
      textPageFooter({
        showingOcr: false,
        ocrLineCount: 0,
        looksScanned: false,
        nativeLineCount: 8,
        pendingTextEdits: 1,
      }),
    ).toMatch(/1 edit ready/);
  });
});
