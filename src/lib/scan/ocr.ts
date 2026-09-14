import type { OcrWord } from "./types";

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

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}
