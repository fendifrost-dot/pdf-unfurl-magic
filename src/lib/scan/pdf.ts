import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { OcrWord } from "./types";

export type ScanPdfPage = {
  jpeg: Uint8Array;
  width: number;
  height: number;
  words?: OcrWord[];
};

const DPI = 150;

function pagePoints(widthPx: number, heightPx: number): { width: number; height: number } {
  return {
    width: (widthPx * 72) / DPI,
    height: (heightPx * 72) / DPI,
  };
}

/**
 * Image-first PDF. OCR words are drawn invisible on top so search works
 * without replacing the scanned page.
 */
export async function buildScanPdf(pages: ScanPdfPage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("Add at least one page before exporting.");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle("PDF Relief scan");
  doc.setProducer("PDF Relief");

  for (const page of pages) {
    const image = await doc.embedJpg(page.jpeg);
    const size = pagePoints(page.width, page.height);
    const pdfPage = doc.addPage([size.width, size.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });

    if (!page.words?.length) continue;
    for (const word of page.words) {
      const boxW = ((word.x1 - word.x0) / page.width) * size.width;
      const boxH = ((word.y1 - word.y0) / page.height) * size.height;
      const x = (word.x0 / page.width) * size.width;
      const y = size.height - (word.y1 / page.height) * size.height;
      const fontSize = Math.max(4, Math.min(boxH * 0.9, 36));
      try {
        pdfPage.drawText(word.text, {
          x,
          y,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          opacity: 0,
          maxWidth: Math.max(boxW, fontSize),
        });
      } catch {
        // Skip a word that cannot be encoded in Helvetica (rare symbols).
      }
    }
  }

  return doc.save();
}

export function defaultScanFilename(pageCount: number): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `scan-${y}-${m}-${d}-${pageCount}p.pdf`;
}
