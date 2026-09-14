import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildSamplePdf } from "./pdf-tools";
import {
  applyTextPatches,
  applyTextPatchesWithReport,
  decodePageContent,
  inspectTextPatch,
  listPageShownText,
  pageHasWhiteCover,
} from "./pdf-text-edit";
import { groupTextItems } from "./pdf-runtime";

describe("groupTextItems", () => {
  it("keeps table amounts as their own run so a total can be edited alone", () => {
    const lines = groupTextItems(
      [
        { str: "Total due", x: 420, y: 400, w: 50, h: 11, fontName: "F2", fontFamily: "Helvetica" },
        { str: "1,987.00", x: 490, y: 400, w: 44, h: 11, fontName: "F2", fontFamily: "Helvetica" },
      ],
      1,
    );
    expect(lines.map((l) => l.text)).toEqual(["Total due", "1,987.00"]);
  });

  it("joins a wrapped sentence on the same baseline", () => {
    const lines = groupTextItems(
      [
        { str: "Valid for", x: 56, y: 700, w: 48, h: 10, fontName: "F1", fontFamily: "Helvetica" },
        { str: "30 days.", x: 108, y: 700, w: 44, h: 10, fontName: "F1", fontFamily: "Helvetica" },
      ],
      1,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("Valid for 30 days.");
  });
});

describe("safe text replace", () => {
  it("rewrites a Helvetica-Bold amount in place and leaves page 2 intact", async () => {
    const sample = await buildSamplePdf();
    const before = sample.slice().buffer as ArrayBuffer;
    const page2Before = await decodePageContent(before, 2);
    expect(page2Before).toContain("REF-4421");
    expect(page2Before).toContain("UNTOUCHED PAGE");

    const shown = await listPageShownText(before, 1);
    expect(shown).toContain("1,987.00");
    expect(shown).toContain("SKU  NG-BENCH-40-OAK");
    expect(shown).toContain("Terms follow the Joinery Supply Agreement, clause 4.");

    const inspection = await inspectTextPatch(before, {
      page: 1,
      x: 490,
      y: 0,
      width: 60,
      height: 14,
      fontSize: 11,
      text: "2,257.00",
      originalText: "1,987.00",
      fontFamily: "Helvetica",
    });
    expect(inspection.found).toBe(true);
    expect(inspection.method).toBe("in-place");
    expect(inspection.fontLabel).toMatch(/Helvetica-Bold/);

    const { bytes, reports } = await applyTextPatchesWithReport(before, [
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
    ]);
    const out = bytes.slice().buffer as ArrayBuffer;

    expect(reports[0]?.method).toBe("in-place");
    const after = await listPageShownText(out, 1);
    expect(after).toContain("2,257.00");
    expect(after).not.toContain("1,987.00");
    expect(after).toContain("Total due");
    expect(after).toContain("Northgate Joinery");
    expect(after).toContain("SKU  NG-BENCH-40-OAK");
    expect(await pageHasWhiteCover(out, 1, { x: 480, y: 0, width: 80, height: 40 })).toBe(false);

    const page2After = await decodePageContent(out, 2);
    expect(page2After).toBe(page2Before);
  });

  it("refuses characters that would bake in question-mark glyphs", async () => {
    const sample = await buildSamplePdf();
    await expect(
      applyTextPatches(sample.slice().buffer as ArrayBuffer, [
        {
          page: 1,
          x: 56,
          y: 0,
          width: 200,
          height: 20,
          fontSize: 20,
          text: "你好",
          originalText: "Northgate Joinery",
        },
      ]),
    ).rejects.toThrow(/safely replace/);
  });

  it("does not emit a TouchUp-style white cover when redrawing a stand-in font", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    // Simulate a subsetted custom name that we will not write new glyphs into.
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("ABC", { x: 40, y: 200, size: 12, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();

    const out = await applyTextPatches(bytes.slice().buffer as ArrayBuffer, [
      {
        page: 1,
        x: 40,
        y: 200,
        width: 40,
        height: 14,
        fontSize: 12,
        text: "XYZ",
        originalText: "ABC",
        fontFamily: "Helvetica",
      },
    ]);
    const shown = await listPageShownText(out.slice().buffer as ArrayBuffer, 1);
    expect(shown).toContain("XYZ");
    expect(shown).not.toContain("ABC");
    expect(
      await pageHasWhiteCover(out.slice().buffer as ArrayBuffer, 1, {
        x: 40,
        y: 200,
        width: 40,
        height: 14,
      }),
    ).toBe(false);
  });
});
