/**
 * Local-first OCR verify loop for damaged scans.
 *
 * After Enhance & OCR, uncertain Tesseract snippets must be Accepted,
 * Corrected, or Skipped before they become editable Apply commits.
 * Damaged pages: Enhance → Verify → Edit — never silent bad OCR.
 *
 * Phase 2 (not in this MVP): optional AI assist for uncertain glyphs.
 * Do not add paid API keys, cloud OCR, or AGPL engines here. Files stay
 * on-device. See `suggestOcrCorrection`.
 */
import type { TextLine } from "./pdf-runtime";
import { canApplyTextEdit } from "./edit-apply";

/** Words below this never enter the OCR overlay (noise). */
export const OCR_KEEP_CONFIDENCE = 40;

/** Tesseract 0–100. At or above this, a word/line can skip the verify gate. */
export const OCR_UNCERTAIN_CONFIDENCE = 70;

export type OcrVerifyStatus = "pending" | "accepted" | "corrected" | "skipped";

export type OcrUncertainSnippet = {
  id: string;
  lineId: string;
  text: string;
  confidence: number;
  status: OcrVerifyStatus;
  /** Word index inside `line.ocrWords`, or -1 for a whole-line snippet. */
  wordIndex: number;
  correctedText?: string;
};

export function isUncertainConfidence(confidence: number | undefined): boolean {
  if (typeof confidence !== "number") return false;
  return confidence < OCR_UNCERTAIN_CONFIDENCE;
}

export function collectUncertainSnippets(lines: TextLine[]): OcrUncertainSnippet[] {
  const out: OcrUncertainSnippet[] = [];
  for (const line of lines) {
    if (line.source !== "ocr") continue;
    const words = line.ocrWords;
    if (words && words.length > 0) {
      words.forEach((word, index) => {
        if (!isUncertainConfidence(word.confidence)) return;
        out.push({
          id: `${line.id}-w${index}`,
          lineId: line.id,
          text: word.text,
          confidence: word.confidence,
          status: "pending",
          wordIndex: index,
        });
      });
      continue;
    }
    if (isUncertainConfidence(line.confidence)) {
      out.push({
        id: `${line.id}-line`,
        lineId: line.id,
        text: line.text,
        confidence: line.confidence ?? 0,
        status: "pending",
        wordIndex: -1,
      });
    }
  }
  return out;
}

export function pendingOcrSnippets(snippets: OcrUncertainSnippet[]): OcrUncertainSnippet[] {
  return snippets.filter((snippet) => snippet.status === "pending");
}

export function lineHasPendingVerify(lineId: string, snippets: OcrUncertainSnippet[]): boolean {
  return snippets.some((snippet) => snippet.lineId === lineId && snippet.status === "pending");
}

/** True when Apply must stay disabled for this OCR line. */
export function ocrVerifyBlocksApply(input: {
  source?: TextLine["source"];
  lineId?: string | null;
  snippets?: OcrUncertainSnippet[];
}): boolean {
  if (input.source !== "ocr") return false;
  if (!input.lineId || !input.snippets?.length) return false;
  return lineHasPendingVerify(input.lineId, input.snippets);
}

export function canApplyWithOcrVerify(input: {
  source?: TextLine["source"];
  selectedIsOcr?: boolean;
  deferToScan?: boolean;
  canCommitSafely: boolean;
  looksScanned?: boolean;
  hasTextOperator?: boolean;
  lineId?: string | null;
  snippets?: OcrUncertainSnippet[];
}): boolean {
  const verifyPending = ocrVerifyBlocksApply({
    source: input.source,
    lineId: input.lineId,
    snippets: input.snippets,
  });
  return canApplyTextEdit({
    selectedIsOcr: input.selectedIsOcr,
    source: input.source,
    deferToScan: input.deferToScan,
    canCommitSafely: input.canCommitSafely,
    looksScanned: input.looksScanned,
    hasTextOperator: input.hasTextOperator,
    ocrVerifyPending: verifyPending,
  });
}

export type OcrVerifyDecision =
  { status: "accepted" } | { status: "skipped" } | { status: "corrected"; text: string };

function rewriteLineText(
  line: TextLine,
  snippet: OcrUncertainSnippet,
  nextWord: string | null,
): TextLine | null {
  const words = line.ocrWords;
  if (snippet.wordIndex >= 0 && words && words.length > 0) {
    const nextWords = words
      .map((word, index) => {
        if (index !== snippet.wordIndex) return word;
        if (nextWord === null) return null;
        return { ...word, text: nextWord, confidence: 100 };
      })
      .filter((word): word is NonNullable<typeof word> => word !== null);
    if (nextWords.length === 0) return null;
    const text = nextWords
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return null;
    const confidence = nextWords.reduce((sum, word) => sum + word.confidence, 0) / nextWords.length;
    return { ...line, text, ocrWords: nextWords, confidence };
  }
  if (nextWord === null) return null;
  const text = nextWord.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return { ...line, text, confidence: 100 };
}

export function applyOcrVerifyDecision(
  lines: TextLine[],
  snippets: OcrUncertainSnippet[],
  snippetId: string,
  decision: OcrVerifyDecision,
): { lines: TextLine[]; snippets: OcrUncertainSnippet[] } {
  const snippet = snippets.find((item) => item.id === snippetId);
  if (!snippet) return { lines, snippets };

  const nextSnippets = snippets.map((item) => {
    if (item.id !== snippetId) return item;
    if (decision.status === "corrected") {
      return {
        ...item,
        status: "corrected" as const,
        correctedText: decision.text,
        text: decision.text,
        confidence: 100,
      };
    }
    return { ...item, status: decision.status };
  });

  const nextLines: TextLine[] = [];
  for (const line of lines) {
    if (line.id !== snippet.lineId) {
      nextLines.push(line);
      continue;
    }
    if (decision.status === "accepted") {
      nextLines.push(line);
      continue;
    }
    const rewritten = rewriteLineText(
      line,
      snippet,
      decision.status === "skipped" ? null : decision.text,
    );
    if (rewritten) nextLines.push(rewritten);
  }

  const liveIds = new Set(nextLines.map((line) => line.id));
  const pruned = nextSnippets.filter((item) => liveIds.has(item.lineId) || item.id === snippetId);
  return { lines: nextLines, snippets: pruned };
}

export function ocrVerifyNextStep(pending: number, ocrLineCount: number): string {
  if (pending > 0) {
    const noun = pending === 1 ? "1 uncertain OCR snippet" : `${pending} uncertain OCR snippets`;
    return `${noun}. Accept, correct, or skip each before Apply. Damaged pages go Enhance → Verify → Edit — not silent bad OCR.`;
  }
  const noun = ocrLineCount === 1 ? "1 OCR line" : `${ocrLineCount} OCR lines`;
  return `${noun} verified. Click a line, edit it, Apply to page, then Export.`;
}

/**
 * Phase 2 — optional AI assist for uncertain glyphs.
 *
 * Intentionally returns null in MVP. Cloud / paid OCR (Vision, Textract,
 * Mistral, etc.) is out of scope: files stay here, no API keys, no AGPL.
 * A later local model or user-supplied key can implement this without
 * changing the Accept / Correct / Skip UI.
 */
export async function suggestOcrCorrection(_input: {
  text: string;
  confidence: number;
  image?: Blob;
}): Promise<string | null> {
  return null;
}
