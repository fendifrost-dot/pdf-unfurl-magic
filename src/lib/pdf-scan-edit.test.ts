import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { encodePng } from "./tiny-png";
import { bytesToLatin1 } from "./pdf-content-stream";
import { listPageShownText, decodePageContent, applyTextPatches } from "./pdf-text-edit";
import { groupOcrWords } from "./scan/ocr";
import {
  applyScanPagePatches,
  classifyPageScan,
  inspectPageScan,
  matchPdfJsLines,
  ocrBoxesToTextLines,
} from "./pdf-scan-edit";
import { applyWorkshopPatches } from "./pdf-tools";

const BLUE = encodePng(1, 1, Uint8Array.from([40, 90, 180, 255]));

async function imageOnlyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const image = await doc.embedPng(BLUE);
  page.drawImage(image, { x: 0, y: 0, width: 400, height: 500 });
  return doc.save();
}

async function ghostOcrPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const image = await doc.embedPng(BLUE);
  page.drawImage(image, { x: 0, y: 0, width: 400, height: 500 });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = "POS DEBIT 6205";
  let x = 40;
  for (const ch of text) {
    page.drawText(ch, { x, y: 400, size: 10, font, color: rgb(0, 0, 0), opacity: 0 });
    x += 7;
  }
  return doc.save();
}

async function twoPageMixed(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const scan = doc.addPage([400, 500]);
  const image = await doc.embedPng(BLUE);
  scan.drawImage(image, { x: 0, y: 0, width: 400, height: 500 });
  const keep = doc.addPage([400, 500]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  keep.drawText("KEEP_PAGE_2", { x: 40, y: 400, size: 14, font, color: rgb(0.1, 0.1, 0.1) });
  return doc.save();
}

describe("scan page classification", () => {
  it("does not flag a real Helvetica page", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("REPLACE_ME", { x: 40, y: 300, size: 12, font });
    const bytes = await doc.save();
    const report = await inspectPageScan(bytes.buffer as ArrayBuffer, 1, ["REPLACE_ME"]);
    expect(report.looksScanned).toBe(false);
    expect(report.reason).toBe("ok");
    expect(report.showCount).toBeGreaterThan(0);
  });

  it("flags the committed scan-image-only fixture", async () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../fixtures/scan-image-only.pdf",
    );
    const buf = readFileSync(path);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const report = await inspectPageScan(bytes, 1, ["AMOUNT 1987.00", "SCAN FIXTURE"]);
    expect(report.looksScanned).toBe(true);
    expect(report.reason).toBe("image-only");
    expect(report.showCount).toBe(0);
  });

  it("flags an image-only page", async () => {
    const bytes = await imageOnlyPdf();
    const report = await inspectPageScan(bytes.buffer as ArrayBuffer, 1, []);
    expect(report.looksScanned).toBe(true);
    expect(report.reason).toBe("image-only");
    expect(report.showCount).toBe(0);
    expect(report.imageCount).toBeGreaterThan(0);
  });

  it("flags OCR-ghost selectable text that is not a matching operator", async () => {
    const bytes = await ghostOcrPdf();
    const report = await inspectPageScan(bytes.buffer as ArrayBuffer, 1, ["POS DEBIT 6205"]);
    expect(report.looksScanned).toBe(true);
    expect(report.reason).toBe("ocr-ghost");
    expect(report.matchRatio).toBeLessThan(0.35);
  });

  it("keeps vector text + a small photo as a text page", () => {
    const classified = classifyPageScan({
      showCount: 8,
      imageCount: 1,
      pdfJsLineCount: 8,
      matchRatio: 1,
    });
    expect(classified.looksScanned).toBe(false);
  });

  it("matches PDF.js lines only on exact operator strings", () => {
    const stats = matchPdfJsLines(["POS", "DEBIT", "6205"], ["POS DEBIT 6205"]);
    expect(stats.matchedLineCount).toBe(0);
    expect(stats.matchRatio).toBe(0);
  });
});

describe("OCR line grouping", () => {
  it("keeps an amount column separate from the label on the same baseline", () => {
    const lines = groupOcrWords([
      { text: "Total due", x0: 20, y0: 40, x1: 90, y1: 54, confidence: 90 },
      { text: "1,987.00", x0: 200, y0: 41, x1: 260, y1: 54, confidence: 88 },
    ]);
    expect(lines.map((line) => line.text)).toEqual(["Total due", "1,987.00"]);
  });

  it("joins neighbouring words on a line", () => {
    const lines = groupOcrWords([
      { text: "Paid", x0: 10, y0: 10, x1: 40, y1: 22, confidence: 80 },
      { text: "To", x0: 44, y0: 10, x1: 60, y1: 22, confidence: 80 },
      { text: "PayPal", x0: 64, y0: 10, x1: 110, y1: 22, confidence: 80 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("Paid To PayPal");
  });

  it("maps pixel boxes into PDF user space", () => {
    const [line] = ocrBoxesToTextLines(
      [{ text: "1,987.00", x0: 100, y0: 50, x1: 200, y1: 70, confidence: 92 }],
      1,
      400,
      500,
      400,
      500,
    );
    expect(line?.source).toBe("ocr");
    expect(line?.x).toBeCloseTo(100);
    expect(line?.y).toBeCloseTo(430);
    expect(line?.width).toBeCloseTo(100);
    expect(line?.height).toBeCloseTo(20);
  });
});

describe("scan-aware export", () => {
  it("writes OCR edits as a text layer and leaves other pages untouched", async () => {
    const source = await twoPageMixed();
    const before = source.slice().buffer as ArrayBuffer;
    const page2Before = await decodePageContent(before, 2);

    const out = await applyScanPagePatches(before, [
      {
        page: 1,
        imageBytes: BLUE,
        pixelWidth: 1,
        pixelHeight: 1,
        lines: [
          {
            x: 40,
            y: 420,
            width: 80,
            height: 14,
            fontSize: 12,
            originalText: "1,987.00",
            text: "2,257.00",
          },
          {
            x: 40,
            y: 400,
            width: 120,
            height: 12,
            fontSize: 10,
            originalText: "SCAN FIXTURE",
            text: "SCAN FIXTURE",
          },
        ],
      },
    ]);

    const shown = await listPageShownText(out.slice().buffer as ArrayBuffer, 1);
    expect(shown).toContain("2,257.00");
    expect(shown).not.toContain("1,987.00");
    expect(shown).toContain("SCAN FIXTURE");
    expect(await decodePageContent(out.slice().buffer as ArrayBuffer, 2)).toBe(page2Before);

    const raw = bytesToLatin1(out);
    expect(raw).toMatch(/\b3\s+Tr\b/);
    expect(raw).not.toMatch(/\/ca\s+0/);
  });

  it("does not send scan OCR edits through the in-place text engine", async () => {
    const sample = await imageOnlyPdf();
    await expect(
      applyTextPatches(sample.slice().buffer as ArrayBuffer, [
        {
          page: 1,
          x: 40,
          y: 400,
          width: 80,
          height: 14,
          fontSize: 12,
          text: "2,257.00",
          originalText: "1,987.00",
        },
      ]),
    ).rejects.toThrow(/safely replace/);

    const exported = await applyWorkshopPatches(
      sample.slice().buffer as ArrayBuffer,
      [],
      [],
      [],
      [
        {
          page: 1,
          imageBytes: BLUE,
          pixelWidth: 1,
          pixelHeight: 1,
          lines: [
            {
              x: 40,
              y: 400,
              width: 80,
              height: 14,
              fontSize: 12,
              originalText: "1,987.00",
              text: "2,257.00",
            },
          ],
        },
      ],
    );
    const shown = await listPageShownText(exported.slice().buffer as ArrayBuffer, 1);
    expect(shown).toContain("2,257.00");
  });
});
