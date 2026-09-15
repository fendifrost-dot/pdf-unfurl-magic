import { describe, expect, it } from "vitest";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  PdfJsEditorType,
  PDFJS_EDITOR_PREFIX,
  listPageAnnotationSubtypes,
  partitionMarks,
  saveEditorAnnotations,
  serializeEditorMarks,
  writeEditorAnnotationsWithPdfLib,
} from "./pdf-annotate-js";
import { applyPageMarks } from "./pdf-marks";
import { applyWorkshopPatches, buildSamplePdf } from "./pdf-tools";
import { bytesToArrayBuffer } from "./pdf-io";
import { listPageShownText, pageHasWhiteCover } from "./pdf-text-edit";
import { encodePng } from "./tiny-png";

GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function highlightMark(id = "h1") {
  return {
    id,
    page: 1,
    kind: "highlight" as const,
    x: 56,
    y: 700,
    width: 200,
    height: 16,
  };
}

function noteMark(id = "n1") {
  return {
    id,
    page: 1,
    kind: "note" as const,
    x: 360,
    y: 600,
    width: 140,
    height: 60,
    text: "Check the total",
  };
}

describe("pdf.js editor payloads", () => {
  it("serializes highlight and FreeText the way saveDocument expects", () => {
    const stored = serializeEditorMarks([highlightMark(), noteMark()]);
    expect(stored).toHaveLength(2);
    expect(stored[0]?.key.startsWith(PDFJS_EDITOR_PREFIX)).toBe(true);
    expect(stored[0]?.value.annotationType).toBe(PdfJsEditorType.HIGHLIGHT);
    expect(stored[0]?.value.pageIndex).toBe(0);
    expect(stored[0]?.value.quadPoints).toHaveLength(8);
    expect(stored[0]?.value.outlines?.[0]).toHaveLength(8);
    expect(stored[1]?.value.annotationType).toBe(PdfJsEditorType.FREETEXT);
    expect(stored[1]?.value.value).toBe("Check the total");
  });

  it("sends redact to the burn lane and underline/rect to native annots", () => {
    const { burn, editor, native, erase } = partitionMarks([
      highlightMark(),
      { id: "r", page: 1, kind: "redact", x: 0, y: 0, width: 10, height: 10 },
      { id: "e", page: 1, kind: "erase", x: 0, y: 0, width: 10, height: 10 },
      { id: "u", page: 1, kind: "underline", x: 0, y: 0, width: 10, height: 10 },
      { id: "b", page: 1, kind: "rect", x: 0, y: 0, width: 10, height: 10 },
    ]);
    expect(editor.map((m) => m.kind)).toEqual(["highlight"]);
    expect(burn.map((m) => m.kind)).toEqual(["redact"]);
    expect(erase.map((m) => m.kind)).toEqual(["erase"]);
    expect(native.map((m) => m.kind)).toEqual(["underline", "rect"]);
  });
});

describe("annotation save", () => {
  it("writes a Highlight annotation through pdf.js saveDocument", async () => {
    const sample = await buildSamplePdf();
    const result = await saveEditorAnnotations(sample, [highlightMark()]);
    expect(result.via).toBe("pdfjs-saveDocument");
    expect(await listPageAnnotationSubtypes(result.bytes, 1)).toContain("Highlight");
    const shown = await listPageShownText(bytesToArrayBuffer(result.bytes), 1);
    expect(shown).toContain("1,987.00");
    expect(shown).toContain("Northgate Joinery");
  });

  it("writes a FreeText annotation for a note", async () => {
    const sample = await buildSamplePdf();
    const result = await saveEditorAnnotations(sample, [noteMark()]);
    expect(result.via).toBe("pdfjs-saveDocument");
    expect(await listPageAnnotationSubtypes(result.bytes, 1)).toContain("FreeText");
    const proxy = await getDocument({ data: result.bytes.slice() }).promise;
    try {
      const page = await proxy.getPage(1);
      const annots = await page.getAnnotations();
      const blob = JSON.stringify(annots);
      expect(blob).toMatch(/Check the total/);
    } finally {
      await proxy.destroy();
    }
  });

  it("falls back to pdf-lib Highlight / FreeText dicts", async () => {
    const sample = await buildSamplePdf();
    const bytes = await writeEditorAnnotationsWithPdfLib(sample, [
      highlightMark("h2"),
      noteMark("n2"),
    ]);
    const subtypes = await listPageAnnotationSubtypes(bytes, 1);
    expect(subtypes).toEqual(expect.arrayContaining(["Highlight", "FreeText"]));
  });

  it("keeps in-place text rewrite when a highlight is saved", async () => {
    const sample = await buildSamplePdf();
    const exported = await applyWorkshopPatches(
      sample.slice().buffer as ArrayBuffer,
      [
        {
          page: 1,
          x: 490,
          y: 0,
          width: 60,
          height: 14,
          fontSize: 11,
          text: "2,257.00",
          originalText: "1,987.00",
          fontFamily: "Helvetica",
        },
      ],
      [],
      [highlightMark()],
    );
    const shown = await listPageShownText(bytesToArrayBuffer(exported), 1);
    expect(shown).toContain("2,257.00");
    expect(shown).not.toContain("1,987.00");
    expect(await listPageAnnotationSubtypes(exported, 1)).toContain("Highlight");
    expect(
      await pageHasWhiteCover(bytesToArrayBuffer(exported), 1, {
        x: 480,
        y: 0,
        width: 80,
        height: 40,
      }),
    ).toBe(false);
  });

  it("labels visual redact as a burn that does not remove extractable text", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("SECRET", { x: 20, y: 100, size: 18, font, color: rgb(0, 0, 0) });
    const probe = await doc.save();
    const burned = await applyPageMarks(probe, [
      { id: "r", page: 1, kind: "redact", x: 16, y: 90, width: 90, height: 24 },
    ]);
    expect(await listPageAnnotationSubtypes(burned, 1)).not.toContain("Highlight");
    const shown = await listPageShownText(bytesToArrayBuffer(burned), 1);
    expect(shown).toContain("SECRET");
  });

  it("writes underline and rectangle as native annotations, not burns", async () => {
    const sample = await buildSamplePdf();
    const marked = await applyPageMarks(sample, [
      { id: "u1", page: 1, kind: "underline", x: 56, y: 640, width: 180, height: 14 },
      { id: "b1", page: 1, kind: "rect", x: 80, y: 400, width: 40, height: 30 },
    ]);
    const subtypes = await listPageAnnotationSubtypes(marked, 1);
    expect(subtypes).toEqual(expect.arrayContaining(["Underline", "Square"]));
  });

  it("keeps a scan OCR text layer when a highlight is saved", async () => {
    const blue = encodePng(1, 1, Uint8Array.from([40, 90, 180, 255]));
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 500]);
    const image = await doc.embedPng(blue);
    page.drawImage(image, { x: 0, y: 0, width: 400, height: 500 });
    const sample = await doc.save();
    const exported = await applyWorkshopPatches(
      bytesToArrayBuffer(sample),
      [],
      [],
      [highlightMark()],
      [
        {
          page: 1,
          imageBytes: blue,
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
    const shown = await listPageShownText(bytesToArrayBuffer(exported), 1);
    expect(shown).toContain("2,257.00");
    expect(await listPageAnnotationSubtypes(exported, 1)).toContain("Highlight");
  });
});
