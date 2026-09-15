import type { OcrLineBox, OcrWord } from "./types";

type TesseractWorker = {
  recognize: (
    image: Blob | HTMLCanvasElement,
    options?: object,
    output?: { text?: boolean; blocks?: boolean },
  ) => Promise<{
    data: {
      blocks?: Array<{
        paragraphs?: Array<{
          lines?: Array<{
            words?: Array<{
              text: string;
              confidence: number;
              bbox: { x0: number; y0: number; x1: number; y1: number };
            }>;
          }>;
        }>;
      }> | null;
    };
  }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

function sanitizeWord(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return (await createWorker("eng", 1, {
        errorHandler: () => undefined,
      })) as TesseractWorker;
    })();
  }
  return workerPromise;
}

/** Optional local OCR. The image is never uploaded; only the engine may be fetched once. */
export async function recognizePage(image: Blob | HTMLCanvasElement): Promise<OcrWord[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = sanitizeWord(word.text);
          const box = word.bbox;
          if (!text || word.confidence < 40) continue;
          if (box.x1 <= box.x0 || box.y1 <= box.y0) continue;
          words.push({
            text,
            x0: box.x0,
            y0: box.y0,
            x1: box.x1,
            y1: box.y1,
            confidence: word.confidence,
          });
        }
      }
    }
  }
  return words;
}

/**
 * Join OCR words into reading-order lines. Words on the same baseline stay
 * together; large gaps (amount columns) stay as their own line so a total
 * can be edited without rewriting the label.
 */
export function groupOcrWords(words: OcrWord[]): OcrLineBox[] {
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const groups: OcrWord[][] = [];

  for (const word of sorted) {
    const last = groups[groups.length - 1];
    if (!last || last.length === 0) {
      groups.push([word]);
      continue;
    }
    const lineY0 = Math.min(...last.map((item) => item.y0));
    const lineY1 = Math.max(...last.map((item) => item.y1));
    const wordH = Math.max(1, word.y1 - word.y0);
    const lineH = Math.max(1, lineY1 - lineY0);
    const overlap = Math.min(lineY1, word.y1) - Math.max(lineY0, word.y0);
    const sameLine = overlap > Math.min(lineH, wordH) * 0.4;
    if (!sameLine) {
      groups.push([word]);
      continue;
    }
    const prev = last[last.length - 1]!;
    const gap = word.x0 - prev.x1;
    const colGap = Math.max(18, Math.max(wordH, prev.y1 - prev.y0) * 1.6);
    if (gap > colGap) {
      groups.push([word]);
    } else {
      last.push(word);
    }
  }

  return groups
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.x0 - b.x0);
      const text = ordered
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return null;
      const confidence = ordered.reduce((sum, item) => sum + item.confidence, 0) / ordered.length;
      return {
        text,
        x0: Math.min(...ordered.map((item) => item.x0)),
        y0: Math.min(...ordered.map((item) => item.y0)),
        x1: Math.max(...ordered.map((item) => item.x1)),
        y1: Math.max(...ordered.map((item) => item.y1)),
        confidence,
      };
    })
    .filter((line): line is OcrLineBox => line !== null);
}

/** OCR that returns line boxes, using Tesseract's line groups when present. */
export async function recognizePageLines(image: Blob | HTMLCanvasElement): Promise<OcrLineBox[]> {
  const words = await recognizePage(image);
  return groupOcrWords(words);
}

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}
