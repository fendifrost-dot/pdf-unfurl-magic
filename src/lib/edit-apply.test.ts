import { StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { canCommitSafely, type TextEditInspection } from "./pdf-text-edit";
import {
  APPLY_EDIT_LABEL,
  APPLY_SUCCESS_MESSAGE,
  canApplyTextEdit,
  enhanceOpenAfterTextChip,
  emptySelectionCopy,
  LEAVE_ENHANCE_LABEL,
  linesForTextEdit,
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
  textPickVisible,
  columnFieldsForLine,
  memberColumnLabel,
  membersForLinePatch,
  remapColumnMemberTexts,
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

  it("Leave Enhance / Text pick stay available after OCR without an export round-trip", () => {
    expect(textPickVisible("text")).toBe(true);
    expect(textPickVisible("image")).toBe(false);
    expect(LEAVE_ENHANCE_LABEL).toMatch(/leave enhance/i);
    expect(
      nextEnhanceOpen({
        userClosed: true,
        looksScanned: true,
        ocrLineCount: 125,
        hashEnhance: true,
      }),
    ).toBe(false);
    expect(
      preferOcrOverlay({
        enhanceOpen: false,
        ocrLineCount: 125,
        nativeLineCount: 40,
        looksScanned: false,
      }),
    ).toBe(false);
    expect(
      linesForTextEdit({
        enhanceOpen: false,
        ocrLines: [{ id: "ocr" }],
        nativeLines: [{ id: "native" }],
      }),
    ).toEqual([{ id: "native" }]);
    expect(
      emptySelectionCopy({
        showingOcr: false,
        ocrLineCount: 125,
        pendingVerify: 3,
        hasDoc: true,
        lineCount: 40,
        textSelectMode: "line",
      }).body,
    ).toMatch(/click any line on the page/i);
    expect(
      emptySelectionCopy({
        showingOcr: true,
        ocrLineCount: 125,
        pendingVerify: 0,
        hasDoc: true,
        lineCount: 125,
        textSelectMode: "line",
      }).body,
    ).toMatch(/leave enhance/i);
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
        looksScanned: false,
        ocrLineCount: 0,
        hashEnhance: true,
      }),
    ).toBe(true);
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

  it("blocks OCR Apply while low-confidence snippets are still pending", () => {
    expect(
      canApplyTextEdit({
        selectedIsOcr: true,
        source: "ocr",
        canCommitSafely: true,
        ocrVerifyPending: true,
      }),
    ).toBe(false);
    expect(
      canApplyTextEdit({
        selectedIsOcr: true,
        source: "ocr",
        canCommitSafely: true,
        ocrVerifyPending: false,
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

  it("keeps native click-to-edit after Enhance & OCR on a digital text page", () => {
    expect(
      preferOcrOverlay({
        enhanceOpen: true,
        ocrLineCount: 125,
        nativeLineCount: 40,
        looksScanned: false,
      }),
    ).toBe(false);
    expect(
      linesForTextEdit({
        enhanceOpen: true,
        ocrLines: [{ id: "ocr" }],
        nativeLines: [{ id: "native" }],
        looksScanned: false,
      }),
    ).toEqual([{ id: "native" }]);
    expect(
      preferOcrOverlay({
        enhanceOpen: true,
        ocrLineCount: 80,
        nativeLineCount: 0,
        looksScanned: true,
      }),
    ).toBe(true);
    expect(
      preferOcrOverlay({
        enhanceOpen: true,
        ocrLineCount: 80,
        nativeLineCount: 12,
        looksScanned: true,
      }),
    ).toBe(true);
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

  it("labels description / amount / balance columns and maps drafts 1:1", () => {
    expect(
      memberColumnLabel("Paid To merchant", 0, ["Paid To merchant", "500.00", "4,972.29"]),
    ).toBe("Description");
    expect(memberColumnLabel("500.00", 1, ["Paid To merchant", "500.00", "4,972.29"])).toBe(
      "Amount",
    );
    expect(memberColumnLabel("4,972.29", 2, ["Paid To merchant", "500.00", "4,972.29"])).toBe(
      "Balance",
    );
    const line = {
      id: "row",
      x: 50,
      y: 640,
      width: 500,
      height: 14,
      fontSize: 10,
      fontName: "F1",
      fontFamily: "Helvetica",
      text: "Paid To merchant 500.00 4,972.29",
      members: [
        {
          id: "desc",
          x: 50,
          y: 640,
          width: 120,
          height: 14,
          fontSize: 10,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "Paid To merchant",
        },
        {
          id: "amt",
          x: 400,
          y: 640,
          width: 50,
          height: 14,
          fontSize: 10,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "500.00",
        },
        {
          id: "bal",
          x: 500,
          y: 640,
          width: 50,
          height: 14,
          fontSize: 10,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "4,972.29",
        },
      ],
    };
    const fields = columnFieldsForLine(line);
    expect(fields.map((field) => field.label)).toEqual(["Description", "Amount", "Balance"]);
    const members = membersForLinePatch(line, {
      desc: "Paid From merchant",
      amt: "500.00",
      bal: "4,972.29",
    });
    expect(members?.find((member) => member.originalText === "Paid To merchant")?.text).toBe(
      "Paid From merchant",
    );
    expect(members?.find((member) => member.originalText === "500.00")?.x).toBe(400);
    expect(members?.find((member) => member.originalText === "4,972.29")?.x).toBe(500);
  });

  it("labels a June Navy Federal debit with a trailing minus as Amount, not Column 2", () => {
    const texts = ["05-22 Paid To - Applecard", "250.00-", "1,834.34"];
    expect(memberColumnLabel(texts[0]!, 0, texts)).toBe("Description");
    expect(memberColumnLabel(texts[1]!, 1, texts)).toBe("Amount");
    expect(memberColumnLabel(texts[2]!, 2, texts)).toBe("Balance");
    expect(memberColumnLabel("(250.00)", 1, ["05-22 Paid To - Applecard", "(250.00)", "1,834.34"])).toBe(
      "Amount",
    );
    expect(memberColumnLabel("250.00 -", 1, ["05-22 Paid To - Applecard", "250.00 -", "1,834.34"])).toBe(
      "Amount",
    );

    const line = {
      id: "row",
      x: 14,
      y: 520,
      width: 560,
      height: 10,
      fontSize: 8,
      fontName: "F1",
      fontFamily: "Helvetica",
      text: "05-22 Paid To - Applecard 250.00- 1,834.34",
      members: [
        {
          id: "desc",
          x: 14,
          y: 520,
          width: 220,
          height: 10,
          fontSize: 8,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "05-22 Paid To - Applecard",
        },
        {
          id: "amt",
          x: 409,
          y: 520,
          width: 48,
          height: 10,
          fontSize: 8,
          fontName: "F2",
          fontFamily: "Helvetica",
          text: "250.00-",
        },
        {
          id: "bal",
          x: 517,
          y: 520,
          width: 48,
          height: 10,
          fontSize: 8,
          fontName: "F2",
          fontFamily: "Helvetica",
          text: "1,834.34",
        },
      ],
    };
    const fields = columnFieldsForLine(line);
    expect(fields.map((field) => ({ label: field.label, text: field.text, x: field.x }))).toEqual([
      { label: "Description", text: "05-22 Paid To - Applecard", x: 14 },
      { label: "Amount", text: "250.00-", x: 409 },
      { label: "Balance", text: "1,834.34", x: 517 },
    ]);
  });

  it("labels a parenthetical debit amount and never leaves currency as Column 2", () => {
    const line = {
      id: "row",
      x: 14,
      y: 500,
      width: 560,
      height: 10,
      fontSize: 8,
      fontName: "F1",
      fontFamily: "Helvetica",
      text: "05-22 Paid To - Applecard (250.00) 1,834.34",
      members: [
        {
          id: "desc",
          x: 14,
          y: 500,
          width: 220,
          height: 10,
          fontSize: 8,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "05-22 Paid To - Applecard",
        },
        {
          id: "amt",
          x: 409,
          y: 500,
          width: 52,
          height: 10,
          fontSize: 8,
          fontName: "F2",
          fontFamily: "Helvetica",
          text: "(250.00)",
        },
        {
          id: "bal",
          x: 517,
          y: 500,
          width: 48,
          height: 10,
          fontSize: 8,
          fontName: "F2",
          fontFamily: "Helvetica",
          text: "1,834.34",
        },
      ],
    };
    const fields = columnFieldsForLine(line);
    expect(fields.map((field) => field.label)).toEqual(["Description", "Amount", "Balance"]);
    expect(fields[1]).toMatchObject({ text: "(250.00)", x: 409 });
    expect(fields[2]).toMatchObject({ text: "1,834.34", x: 517 });
    expect(fields.some((field) => /^Column \d+$/.test(field.label))).toBe(false);
  });

  it("description-only memberTexts leave trailing-minus amount and balance untouched", () => {
    const line = {
      id: "applecard",
      x: 14,
      y: 700,
      width: 547,
      height: 10,
      fontSize: 8,
      fontName: "F1",
      fontFamily: "Helvetica",
      text: "05-22 Paid To - Applecard Gsbank Payment Chk 12408508 250.00- 1,834.34",
      members: [
        {
          id: "desc",
          x: 14,
          y: 700,
          width: 380,
          height: 10,
          fontSize: 8,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "05-22 Paid To - Applecard Gsbank Payment Chk 12408508",
        },
        {
          id: "amt",
          x: 409,
          y: 700,
          width: 40,
          height: 10,
          fontSize: 8,
          fontName: "F2",
          fontFamily: "Helvetica",
          text: "250.00-",
        },
        {
          id: "bal",
          x: 517,
          y: 700,
          width: 44,
          height: 10,
          fontSize: 8,
          fontName: "F2",
          fontFamily: "Helvetica",
          text: "1,834.34",
        },
      ],
    };
    expect(columnFieldsForLine(line).map((field) => field.label)).toEqual([
      "Description",
      "Amount",
      "Balance",
    ]);
    const members = membersForLinePatch(line, {
      desc: "05-22 Paid From - Applecard Gsbank Payment Chk 12408508",
    });
    expect(members?.find((member) => member.originalText === "250.00-")?.text).toBe("250.00-");
    expect(members?.find((member) => member.originalText === "250.00-")?.x).toBe(409);
    expect(members?.find((member) => member.originalText === "1,834.34")?.text).toBe("1,834.34");
    expect(members?.find((member) => member.originalText === "1,834.34")?.x).toBe(517);
  });

  it("locates patch members at originX and sets targetX after overlay align", () => {
    const line = {
      id: "row",
      x: 50,
      y: 640,
      originX: 50,
      originY: 640,
      width: 500,
      height: 14,
      fontSize: 10,
      fontName: "F1",
      fontFamily: "Helvetica",
      text: "Paid To merchant 500.00 4,972.29",
      members: [
        {
          id: "desc",
          x: 430,
          y: 640,
          originX: 50,
          originY: 640,
          width: 120,
          height: 14,
          fontSize: 10,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "Paid To merchant",
        },
        {
          id: "amt",
          x: 400,
          y: 640,
          originX: 400,
          originY: 640,
          width: 50,
          height: 14,
          fontSize: 10,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "500.00",
        },
        {
          id: "bal",
          x: 500,
          y: 640,
          originX: 500,
          originY: 640,
          width: 50,
          height: 14,
          fontSize: 10,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "4,972.29",
        },
      ],
    };
    const fields = columnFieldsForLine(line);
    expect(fields.map((field) => field.label)).toEqual(["Description", "Amount", "Balance"]);
    expect(fields[1]?.x).toBe(400);
    const members = membersForLinePatch(line, {
      desc: "Paid From merchant",
      amt: "500.00",
      bal: "4,972.29",
    });
    expect(members?.find((member) => member.originalText === "Paid To merchant")).toMatchObject({
      x: 50,
      targetX: 430,
      text: "Paid From merchant",
    });
    expect(members?.find((member) => member.originalText === "500.00")).toMatchObject({
      x: 400,
    });
    expect(members?.find((member) => member.originalText === "500.00")?.targetX).toBeUndefined();
    expect(members?.find((member) => member.originalText === "4,972.29")?.x).toBe(500);
  });

  it("carries a description-only draft onto the expanded full line", () => {
    const desc = {
      id: "desc",
      x: 50,
      y: 640,
      width: 200,
      height: 14,
      fontSize: 10,
      fontName: "F1",
      fontFamily: "Helvetica",
      text: "06-06 Paid To merchant",
      members: [
        {
          id: "desc",
          x: 50,
          y: 640,
          width: 200,
          height: 14,
          fontSize: 10,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "06-06 Paid To merchant",
        },
      ],
    };
    const joined = {
      id: "row",
      x: 50,
      y: 640,
      width: 500,
      height: 14,
      fontSize: 10,
      fontName: "F1",
      fontFamily: "Helvetica",
      text: "06-06 Paid To merchant 500.00 4,972.29",
      members: [
        desc.members[0]!,
        {
          id: "amt",
          x: 400,
          y: 640,
          width: 50,
          height: 14,
          fontSize: 10,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "500.00",
        },
        {
          id: "bal",
          x: 500,
          y: 640,
          width: 50,
          height: 14,
          fontSize: 10,
          fontName: "F1",
          fontFamily: "Helvetica",
          text: "4,972.29",
        },
      ],
    };
    const remapped = remapColumnMemberTexts({
      fromFields: columnFieldsForLine(desc),
      toFields: columnFieldsForLine(joined),
      sourceDraft: "06-06 Paid From merchant",
      sourceWasColumnar: false,
    });
    expect(remapped.desc).toBe("06-06 Paid From merchant");
    expect(remapped.amt).toBe("500.00");
    expect(remapped.bal).toBe("4,972.29");
  });
});
