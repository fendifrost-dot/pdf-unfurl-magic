import {
  PDFDocument,
  StandardFonts,
  beginText,
  endText,
  rgb,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type Color,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { OcrWord } from "./types";

type PageWithFontKey = PDFPage & { fontKey?: string };

function pageFontKey(page: PDFPage): string {
  const key = (page as PageWithFontKey).fontKey;
  if (!key) {
    throw new Error("Set a page font before drawing OCR glyphs.");
  }
  return key;
}

/** Searchable OCR glyphs: neither fill nor stroke (`3 Tr`). Not opacity:0. */
export function setInvisibleOcrTextMode(page: PDFPage) {
  page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
}

/** Restore filled glyphs after an invisible OCR layer (`0 Tr`). */
export function setFillTextMode(page: PDFPage) {
  page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
}

/**
 * Draw one OCR run inside a single BT/ET. `3 Tr` must live *inside* the text
 * object — pdf-lib `drawText` wraps each string in q/BT/ET/Q, so a Tr pushed
 * beforehand is outside BT and viewers may paint the glyphs (stacked on the
 * page image). Never pass maxWidth: wrapping emits T* and stacks fragments
 * onto neighbouring statement rows.
 */
export function drawOcrGlyphs(
  page: PDFPage,
  font: PDFFont,
  text: string,
  options: {
    x: number;
    y: number;
    size: number;
    invisible: boolean;
    color?: Color;
  },
) {
  const drawn = text.replace(/\s*\n\s*/g, " ").trim();
  if (!drawn) return;
  page.setFont(font);
  page.setFontSize(options.size);
  const encoded = font.encodeText(drawn);
  const mode = options.invisible ? TextRenderingMode.Invisible : TextRenderingMode.Fill;
  const ops = [
    beginText(),
    setTextRenderingMode(mode),
    setFillingColor(options.color ?? rgb(0, 0, 0)),
    setFontAndSize(pageFontKey(page), options.size),
    setTextMatrix(1, 0, 0, 1, options.x, options.y),
    showText(encoded),
    endText(),
  ];
  page.pushOperators(...ops);
}

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
 * Image-first PDF. OCR words use text rendering mode 3 (invisible) so search
 * works without painting over the scanned page or relying on opacity:0.
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
      const boxH = ((word.y1 - word.y0) / page.height) * size.height;
      const x = (word.x0 / page.width) * size.width;
      const y = size.height - (word.y1 / page.height) * size.height;
      const fontSize = Math.max(4, Math.min(boxH * 0.9, 36));
      try {
        drawOcrGlyphs(pdfPage, font, word.text, {
          x,
          y,
          size: fontSize,
          invisible: true,
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
