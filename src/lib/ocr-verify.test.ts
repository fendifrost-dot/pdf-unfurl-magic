import { describe, expect, it } from "vitest";
import { canApplyTextEdit } from "./edit-apply";
import {
  applyOcrVerifyDecision,
  canApplyWithOcrVerify,
  collectUncertainSnippets,
  ocrVerifyBlocksApply,
  pendingOcrSnippets,
  suggestOcrCorrection,
  type OcrUncertainSnippet,
} from "./ocr-verify";
import type { TextLine } from "./pdf-runtime";

function ocrLine(partial: Partial<TextLine> & Pick<TextLine, "id" | "text">): TextLine {
  return {
    page: 1,
    x: 40,
    y: 400,
    width: 80,
    height: 12,
    fontSize: 11,
    fontName: "OCR",
    fontFamily: "Helvetica",
    source: "ocr",
    ...partial,
  };
}

describe("OCR verify gate", () => {
  it("collects low-confidence words and blocks Apply until resolved or skipped", () => {
    const lines = [
      ocrLine({
        id: "ocr-hi",
        text: "Total due",
        confidence: 92,
        ocrWords: [
          { text: "Total", confidence: 94 },
          { text: "due", confidence: 90 },
        ],
      }),
      ocrLine({
        id: "ocr-lo",
        text: "1,9B7.00",
        confidence: 48,
        ocrWords: [{ text: "1,9B7.00", confidence: 48 }],
      }),
    ];
    const snippets = collectUncertainSnippets(lines);
    expect(snippets).toHaveLength(1);
    expect(snippets[0]?.text).toBe("1,9B7.00");
    expect(snippets[0]?.status).toBe("pending");
    expect(ocrVerifyBlocksApply({ source: "ocr", lineId: "ocr-lo", snippets })).toBe(true);
    expect(
      canApplyWithOcrVerify({
        source: "ocr",
        selectedIsOcr: true,
        canCommitSafely: true,
        lineId: "ocr-lo",
        snippets,
      }),
    ).toBe(false);
    expect(
      canApplyWithOcrVerify({
        source: "ocr",
        selectedIsOcr: true,
        canCommitSafely: true,
        lineId: "ocr-hi",
        snippets,
      }),
    ).toBe(true);

    const skipped = applyOcrVerifyDecision(lines, snippets, snippets[0]!.id, { status: "skipped" });
    expect(skipped.lines.map((line) => line.id)).toEqual(["ocr-hi"]);
    expect(
      ocrVerifyBlocksApply({
        source: "ocr",
        lineId: "ocr-lo",
        snippets: skipped.snippets,
      }),
    ).toBe(false);
    expect(
      canApplyWithOcrVerify({
        source: "ocr",
        canCommitSafely: true,
        lineId: skipped.lines[0]?.id,
        snippets: skipped.snippets,
      }),
    ).toBe(true);
  });

  it("lets Accept and Correct clear the gate and keeps corrected text", () => {
    const lines = [
      ocrLine({
        id: "ocr-blur",
        text: "Pa1d To",
        confidence: 55,
        ocrWords: [
          { text: "Pa1d", confidence: 41 },
          { text: "To", confidence: 88 },
        ],
      }),
    ];
    const snippets = collectUncertainSnippets(lines);
    expect(snippets.map((item) => item.text)).toEqual(["Pa1d"]);
    expect(pendingOcrSnippets(snippets)).toHaveLength(1);

    const corrected = applyOcrVerifyDecision(lines, snippets, snippets[0]!.id, {
      status: "corrected",
      text: "Paid",
    });
    expect(corrected.lines[0]?.text).toBe("Paid To");
    expect(pendingOcrSnippets(corrected.snippets)).toHaveLength(0);
    expect(
      canApplyWithOcrVerify({
        source: "ocr",
        lineId: "ocr-blur",
        snippets: corrected.snippets,
        canCommitSafely: true,
      }),
    ).toBe(true);

    const accepted = applyOcrVerifyDecision(lines, snippets, snippets[0]!.id, {
      status: "accepted",
    });
    expect(accepted.lines[0]?.text).toBe("Pa1d To");
    expect(accepted.snippets[0]?.status).toBe("accepted");
  });

  it("treats a low-confidence line without words as one snippet", () => {
    const snippets = collectUncertainSnippets([
      ocrLine({ id: "ocr-line", text: "Syd Pay", confidence: 62 }),
    ]);
    expect(snippets).toHaveLength(1);
    expect(snippets[0]?.wordIndex).toBe(-1);
  });

  it("leaves a phase-2 AI hook that does not call a cloud API", async () => {
    const suggestion = await suggestOcrCorrection({ text: "1,9B7.00", confidence: 48 });
    expect(suggestion).toBeNull();
  });

  it("does not invent pending snippets for high-confidence OCR", () => {
    const snippets: OcrUncertainSnippet[] = collectUncertainSnippets([
      ocrLine({ id: "ocr-ok", text: "SCAN FIXTURE", confidence: 91 }),
    ]);
    expect(snippets).toEqual([]);
    expect(
      canApplyTextEdit({
        source: "ocr",
        canCommitSafely: false,
        ocrVerifyPending: false,
      }),
    ).toBe(true);
  });
});
