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
  overlayFillMode,
  overlayHasOpaqueFill,
  overlayShouldPaintLabel,
  pendingExportBanner,
  preferOcrOverlay,
  shouldFlattenPageAsScan,
  textOverlayChromeClass,
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
        selectedIsOcr: true,
        source: "ocr",
        deferToScan: true,
        canCommitSafely: false,
        looksScanned: true,
        scanMode: true,
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
        scanMode: true,
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

  it("false scan detect (looksScanned / scanMode) does not disable native Apply", () => {
    expect(
      canApplyTextEdit({
        selectedIsOcr: false,
        source: "pdfjs",
        deferToScan: false,
        canCommitSafely: true,
        looksScanned: true,
        scanMode: true,
      }),
    ).toBe(true);
  });

  it("canCommitSafely is false on deferToScan, but OCR Apply still enables", () => {
    const deferred: TextEditInspection = {
      ...safeInspection,
      method: "blocked",
      blockReason: "scan-page",
      deferToScan: true,
    };
    expect(canCommitSafely(deferred, "Paid From", "Paid To")).toBe(false);
    expect(
      canApplyTextEdit({
        selectedIsOcr: true,
        source: "ocr",
        deferToScan: deferred.deferToScan,
        canCommitSafely: canCommitSafely(deferred, "Paid From", "Paid To"),
        scanMode: true,
      }),
    ).toBe(true);
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

  it("default applied overlay has no opaque paper/white fill", () => {
    const applied = textOverlayChromeClass({
      isSelected: false,
      isEdited: true,
      isLivePreview: false,
      showHighlight: false,
    });
    expect(overlayFillMode({ isEdited: true, isLivePreview: false, showHighlight: false })).toBe(
      "none",
    );
    expect(overlayHasOpaqueFill(applied)).toBe(false);
    expect(applied).toMatch(/bg-transparent/);
    expect(applied).toMatch(/border-success/);

    const selectedApplied = textOverlayChromeClass({
      isSelected: true,
      isEdited: true,
      isLivePreview: false,
      showHighlight: false,
    });
    expect(overlayHasOpaqueFill(selectedApplied)).toBe(false);
    expect(selectedApplied).toMatch(/border-primary/);
    expect(selectedApplied).toMatch(/bg-transparent/);
  });

  it("live preview overlay is also seamless until the reviewer toggle is on", () => {
    const live = textOverlayChromeClass({
      isSelected: true,
      isEdited: false,
      isLivePreview: true,
      showHighlight: false,
    });
    expect(overlayHasOpaqueFill(live)).toBe(false);
    expect(overlayFillMode({ isEdited: false, isLivePreview: true, showHighlight: false })).toBe(
      "none",
    );
  });

  it("reviewer highlight restores the opaque paper box on applied text", () => {
    const highlighted = textOverlayChromeClass({
      isSelected: false,
      isEdited: true,
      isLivePreview: false,
      showHighlight: true,
    });
    expect(overlayFillMode({ isEdited: true, isLivePreview: false, showHighlight: true })).toBe(
      "highlight",
    );
    expect(overlayHasOpaqueFill(highlighted)).toBe(true);
    expect(highlighted).toMatch(/bg-paper/);
  });

  it("unedited selection chrome is unchanged by the highlight toggle", () => {
    const off = textOverlayChromeClass({
      isSelected: true,
      isEdited: false,
      isLivePreview: false,
      showHighlight: false,
    });
    const on = textOverlayChromeClass({
      isSelected: true,
      isEdited: false,
      isLivePreview: false,
      showHighlight: true,
    });
    expect(off).toBe(on);
    expect(off).toMatch(/bg-primary\/25/);
    expect(overlayHasOpaqueFill(off)).toBe(false);
  });

  it("hides overlay label once the canvas already shows the applied rewrite", () => {
    expect(
      overlayShouldPaintLabel({
        isEdited: true,
        isLivePreview: false,
        showHighlight: false,
        canvasShowsApplied: true,
      }),
    ).toBe(false);
    expect(
      overlayShouldPaintLabel({
        isEdited: true,
        isLivePreview: true,
        showHighlight: false,
        canvasShowsApplied: true,
      }),
    ).toBe(true);
    expect(
      overlayShouldPaintLabel({
        isEdited: true,
        isLivePreview: false,
        showHighlight: true,
        canvasShowsApplied: true,
      }),
    ).toBe(true);
    expect(
      overlayShouldPaintLabel({
        isEdited: true,
        isLivePreview: false,
        showHighlight: false,
        canvasShowsApplied: false,
      }),
    ).toBe(true);
  });
});
