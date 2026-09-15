import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import { buildSamplePdf } from "./pdf-tools";
import {
  applyTextPatches,
  applyTextPatchesWithReport,
  decodePageContent,
  inspectTextLayer,
  inspectTextPatch,
  listPageEmbeddedFonts,
  listPageShownText,
  listPageTextShows,
  pageHasWhiteCover,
} from "./pdf-text-edit";
import { mergeFontCatalog } from "./pdf-font-catalog";
import { groupTextItems } from "./pdf-runtime";

async function decodePageToUnicode(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes.slice());
  const page = doc.getPages()[0];
  const fonts = page?.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fonts) return "";
  const chunks: string[] = [];
  for (const [, value] of fonts.entries()) {
    const dict = doc.context.lookup(value);
    if (!(dict instanceof PDFDict)) continue;
    const toUnicode = dict.lookup(PDFName.of("ToUnicode"));
    const stream =
      toUnicode instanceof PDFRawStream
        ? toUnicode
        : toUnicode
          ? doc.context.lookup(toUnicode)
          : null;
    if (stream instanceof PDFRawStream) {
      chunks.push(Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"));
    }
  }
  return chunks.join("\n");
}

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

  it("glues a split thousands comma back onto the amount", () => {
    const lines = groupTextItems(
      [
        { str: "2", x: 490, y: 400, w: 8, h: 11, fontName: "F2", fontFamily: "Helvetica" },
        { str: ",", x: 498, y: 400, w: 4, h: 11, fontName: "F2", fontFamily: "Helvetica" },
        { str: "500.00", x: 502, y: 400, w: 36, h: 11, fontName: "F2", fontFamily: "Helvetica" },
      ],
      1,
    );
    expect(lines.map((l) => l.text)).toEqual(["2,500.00"]);
  });

  it("reconstructs a thousands comma when PDF.js dropped the punctuation item", () => {
    const lines = groupTextItems(
      [
        { str: "1", x: 490, y: 400, w: 7, h: 11, fontName: "F2", fontFamily: "Helvetica" },
        { str: "987.00", x: 499, y: 400, w: 36, h: 11, fontName: "F2", fontFamily: "Helvetica" },
      ],
      1,
    );
    expect(lines.map((l) => l.text)).toEqual(["1,987.00"]);
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

  it("refuses CJK that bundled Liberation/Noto cannot encode", async () => {
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

  it("embeds Liberation Sans for Łódź and keeps commas instead of writing “?”", async () => {
    const sample = await buildSamplePdf();
    const before = sample.slice().buffer as ArrayBuffer;
    const inspection = await inspectTextPatch(before, {
      page: 1,
      x: 56,
      y: 0,
      width: 200,
      height: 20,
      fontSize: 20,
      text: "Łódź, 2,257.00",
      originalText: "Northgate Joinery",
      fontFamily: "Helvetica",
    });
    expect(inspection.found).toBe(true);
    expect(inspection.method).toBe("redraw-unicode");
    expect(inspection.missingGlyphs).toEqual([]);
    expect(inspection.fontLabel).toMatch(/Liberation Sans|Noto Sans/);
    expect(inspection.message).toMatch(/PRIOR_ART #1/);

    const { bytes, reports } = await applyTextPatchesWithReport(before, [
      {
        page: 1,
        x: 56,
        y: 0,
        width: 200,
        height: 20,
        fontSize: 20,
        text: "Łódź, 2,257.00",
        originalText: "Northgate Joinery",
        fontFamily: "Helvetica",
      },
    ]);
    expect(reports[0]?.method).toBe("redraw-unicode");
    expect(reports[0]?.missingGlyphs).toEqual([]);
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toMatch(/LiberationSans|NotoSans/);
    const cmap = await decodePageToUnicode(bytes);
    expect(cmap).toMatch(/beginbfchar/i);
    expect(cmap.toUpperCase()).toContain("0141");
    expect(cmap.toUpperCase()).toContain("002C");
    const after = await listPageShownText(bytes.slice().buffer as ArrayBuffer, 1);
    expect(after).not.toContain("Northgate Joinery");
    expect(after.join(" ")).not.toMatch(/\?{2,}/);
    expect(
      await pageHasWhiteCover(bytes.slice().buffer as ArrayBuffer, 1, {
        x: 50,
        y: 0,
        width: 220,
        height: 30,
      }),
    ).toBe(false);
  });

  it("edits the comma-amounts fixture in place without dropping the thousands comma", async () => {
    const { readFile } = await import("node:fs/promises");
    const file = await readFile("fixtures/comma-amounts.pdf");
    const before = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer;
    const shown = await listPageShownText(before, 1);
    expect(shown).toContain("2,500.00");

    const { bytes, reports } = await applyTextPatchesWithReport(before, [
      {
        page: 1,
        x: 420,
        y: 710,
        width: 50,
        height: 14,
        fontSize: 11,
        text: "2,750.00",
        originalText: "2,500.00",
        fontFamily: "Helvetica",
      },
    ]);
    expect(reports[0]?.method).toBe("in-place");
    const after = await listPageShownText(bytes.slice().buffer as ArrayBuffer, 1);
    expect(after).toContain("2,750.00");
    expect(after).not.toContain("2,500.00");
    expect(after.join(" ")).not.toContain("?");
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

  it("edits a comma amount and a multi-run line without stripping punctuation", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText("POS Debit", { x: 56, y: 648, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText("Card 6205", { x: 128, y: 648, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText("2,500.00", { x: 420, y: 648, size: 11, font: bold, color: rgb(0.1, 0.1, 0.1) });
    const bytes = await doc.save();
    const before = bytes.slice().buffer as ArrayBuffer;

    const shown = await listPageShownText(before, 1);
    expect(shown).toContain("2,500.00");
    expect(shown).toContain("POS Debit");
    expect(shown).toContain("Card 6205");

    const amount = await inspectTextPatch(before, {
      page: 1,
      x: 420,
      y: 648,
      width: 50,
      height: 14,
      fontSize: 11,
      text: "2,750.00",
      originalText: "2,500.00",
      fontFamily: "Helvetica",
    });
    expect(amount.found).toBe(true);
    expect(amount.method).toBe("in-place");
    expect(amount.deferToScan).toBeFalsy();

    const grouped = await inspectTextPatch(before, {
      page: 1,
      x: 56,
      y: 648,
      width: 160,
      height: 14,
      fontSize: 11,
      text: "POS Debit Card 6205",
      originalText: "POS Debit Card 6205",
      fontFamily: "Helvetica",
    });
    expect(grouped.found).toBe(true);

    const { bytes: out } = await applyTextPatchesWithReport(before, [
      {
        page: 1,
        x: 420,
        y: 648,
        width: 50,
        height: 14,
        fontSize: 11,
        text: "2,750.00",
        originalText: "2,500.00",
        fontFamily: "Helvetica",
      },
    ]);
    const after = await listPageShownText(out.slice().buffer as ArrayBuffer, 1);
    expect(after).toContain("2,750.00");
    expect(after).not.toContain("2,500.00");
    expect(after).toContain("POS Debit");
    expect(after).toContain("Card 6205");
  });

  it("matches a PDF.js-stripped comma amount back to the stream run", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText("2,500.00", { x: 40, y: 200, size: 12, font });
    const bytes = (await doc.save()).slice().buffer as ArrayBuffer;
    const inspection = await inspectTextPatch(bytes, {
      page: 1,
      x: 40,
      y: 200,
      width: 60,
      height: 14,
      fontSize: 12,
      text: "2,600.00",
      originalText: "2 500.00",
      fontFamily: "Helvetica",
    });
    expect(inspection.found).toBe(true);
  });

  it("defers to scan when the page has no text operators", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    const bytes = (await doc.save()).slice().buffer as ArrayBuffer;
    const layer = await inspectTextLayer(bytes, 1);
    expect(layer.kind).toBe("none");
    const inspection = await inspectTextPatch(bytes, {
      page: 1,
      x: 40,
      y: 200,
      width: 80,
      height: 14,
      fontSize: 12,
      text: "hello",
      originalText: "hello",
    });
    expect(inspection.found).toBe(false);
    expect(inspection.deferToScan).toBe(true);
    expect(inspection.blockReason).toBe("scan-page");
    await expect(
      applyTextPatches(bytes, [
        {
          page: 1,
          x: 40,
          y: 200,
          width: 80,
          height: 14,
          fontSize: 12,
          text: "hello",
          originalText: "hello",
        },
      ]),
    ).rejects.toThrow(/safely replace/);
  });

  it("splices a statement fragment without dropping neighbors or the comma amount", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText("06-06 POS Debit- Debit Card 6205 06-26 Amazon Mktp Us", {
      x: 56,
      y: 648,
      size: 10,
      font,
    });
    page.drawText("2,500.00", { x: 420, y: 648, size: 10, font: bold });
    const before = (await doc.save()).slice().buffer as ArrayBuffer;

    const fragment = await inspectTextPatch(before, {
      page: 1,
      x: 56,
      y: 648,
      width: 180,
      height: 12,
      fontSize: 10,
      text: "06 POS Debit Card 6205",
      originalText: "06 POS Debit- Debit Card 6205",
      fontFamily: "Helvetica",
    });
    expect(fragment.found).toBe(true);
    expect(fragment.method).toBe("in-place");
    expect(fragment.deferToScan).toBeFalsy();

    const hyphen = await inspectTextPatch(before, {
      page: 1,
      x: 56,
      y: 648,
      width: 180,
      height: 12,
      fontSize: 10,
      text: "POS Debit Card 6205",
      originalText: "POS Debit - Debit Card 6205",
      fontFamily: "Helvetica",
    });
    expect(hyphen.found).toBe(true);

    const { bytes: out } = await applyTextPatchesWithReport(before, [
      {
        page: 1,
        x: 56,
        y: 648,
        width: 180,
        height: 12,
        fontSize: 10,
        text: "06 POS Debit Card 6205",
        originalText: "06 POS Debit- Debit Card 6205",
        fontFamily: "Helvetica",
      },
    ]);
    const after = await listPageShownText(out.slice().buffer as ArrayBuffer, 1);
    expect(after.some((t) => t.includes("06 POS Debit Card 6205"))).toBe(true);
    expect(after.some((t) => t.includes("Amazon Mktp Us"))).toBe(true);
    expect(after).toContain("2,500.00");
    expect(after.some((t) => t.includes("Debit- Debit"))).toBe(false);
  });

  it("edits the committed comma-amounts fixture in place", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const buf = await readFile(join(process.cwd(), "fixtures/comma-amounts.pdf"));
    const before = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const shown = await listPageShownText(before, 1);
    expect(shown).toContain("2,500.00");
    expect(shown).toContain("1,987.00");
    expect(shown).toContain("POS Debit");
    expect(shown).toContain("Card 6205");

    const inspection = await inspectTextPatch(before, {
      page: 1,
      x: 420,
      y: 710,
      width: 50,
      height: 14,
      fontSize: 11,
      text: "2,750.00",
      originalText: "2,500.00",
      fontFamily: "Helvetica",
    });
    expect(inspection.found).toBe(true);
    expect(inspection.method).toBe("in-place");
    expect(inspection.fontLabel).toMatch(/Helvetica-Bold/);

    const { bytes: out } = await applyTextPatchesWithReport(before, [
      {
        page: 1,
        x: 420,
        y: 710,
        width: 50,
        height: 14,
        fontSize: 11,
        text: "2,750.00",
        originalText: "2,500.00",
        fontFamily: "Helvetica",
      },
    ]);
    const after = await listPageShownText(out.slice().buffer as ArrayBuffer, 1);
    expect(after).toContain("2,750.00");
    expect(after).not.toContain("2,500.00");
    expect(after).toContain("1,987.00");
    expect(after).toContain("POS Debit");
  });

  it("rewrites every member on a joined baseline, including a far-right amount the draft dropped", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    // Column-major order: descriptions first, then amounts — typical statement layout.
    page.drawText("06-06 Paid To - Synchrony card Syf Paymnt Chk 4220268", {
      x: 40,
      y: 640,
      size: 8,
      font,
    });
    page.drawText("06-07 POS Debit Card 6205", { x: 40, y: 624, size: 8, font });
    page.drawText("500.00", { x: 480, y: 640, size: 8, font: bold });
    page.drawText("4,972.29", { x: 540, y: 640, size: 8, font: bold });
    page.drawText("12.00", { x: 480, y: 624, size: 8, font: bold });
    const bytes = await doc.save();
    const before = bytes.slice().buffer as ArrayBuffer;

    const shownBefore = await listPageShownText(before, 1);
    expect(shownBefore).toContain("500.00");
    expect(shownBefore).toContain("4,972.29");

    const originalText = "06-06 Paid To - Synchrony card Syf Paymnt Chk 4220268 500.00 4,972.29";
    const nextText = "06-06 Paid From - Synchrony card Syf Paymnt Chk 4220268";
    const { bytes: out, reports } = await applyTextPatchesWithReport(before, [
      {
        page: 1,
        x: 40,
        y: 640,
        width: 560,
        height: 12,
        fontSize: 8,
        text: nextText,
        originalText,
        // PDF.js join often stores a description-only stream hint; locating
        // that first show must still drop the amount operators the draft covered.
        rawText: "06-06 Paid To - Synchrony card Syf Paymnt Chk 4220268",
        fontFamily: "Helvetica",
      },
    ]);
    expect(reports[0]?.found).toBe(true);
    expect(reports[0]?.method).not.toBe("blocked");
    const after = await listPageShownText(out.slice().buffer as ArrayBuffer, 1);
    expect(after.join(" ")).toMatch(/Paid From/);
    expect(after.join(" ")).not.toMatch(/Paid To/);
    expect(after).not.toContain("500.00");
    expect(after).not.toContain("4,972.29");
    expect(after).toContain("12.00");
    expect(after.join(" ")).toMatch(/06-07 POS Debit/);
    expect(
      await pageHasWhiteCover(out.slice().buffer as ArrayBuffer, 1, {
        x: 40,
        y: 640,
        width: 560,
        height: 12,
      }),
    ).toBe(false);
  });

  it("does not delete a far amount when the draft is description-only", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("06-06 Paid To merchant", { x: 40, y: 640, size: 8, font });
    page.drawText("500.00", { x: 480, y: 640, size: 8, font });
    const bytes = await doc.save();
    const before = bytes.slice().buffer as ArrayBuffer;
    const { bytes: out } = await applyTextPatchesWithReport(before, [
      {
        page: 1,
        x: 40,
        y: 640,
        width: 160,
        height: 12,
        fontSize: 8,
        text: "06-06 Paid From merchant",
        originalText: "06-06 Paid To merchant",
        fontFamily: "Helvetica",
      },
    ]);
    const after = await listPageShownText(out.slice().buffer as ArrayBuffer, 1);
    expect(after.join(" ")).toMatch(/Paid From/);
    expect(after).toContain("500.00");
  });

  it("lists embedded fonts before any stand-in in the picker catalog", async () => {
    const sample = await buildSamplePdf();
    const fonts = await listPageEmbeddedFonts(sample.slice().buffer as ArrayBuffer, 1);
    expect(fonts.some((f) => /Helvetica/i.test(f.baseFont))).toBe(true);
    const catalog = mergeFontCatalog({
      embedded: fonts,
      ...(fonts[0]?.key ? { selectedKey: fonts[0].key } : {}),
      originalText: "1,987.00",
      match: {
        kind: "embedded-standard",
        standard: StandardFonts.HelveticaBold,
        label: "Helvetica-Bold",
        family: "helvetica",
        bold: true,
        italic: false,
      },
    });
    expect(catalog[0]?.source).toBe("embedded");
    expect(catalog[0]?.safety).toBe("safe");
    expect(catalog.some((item) => item.source === "bundled")).toBe(true);
    expect(catalog.some((item) => item.source === "standard")).toBe(true);
  });
});

describe("align writes x into the content stream", () => {
  it("Align Right shares a right edge and Snap restores original xs", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Paid To", { x: 50, y: 640, size: 10, font });
    page.drawText("500.00", { x: 400, y: 640, size: 10, font });
    page.drawText("1,200.00", { x: 500, y: 640, size: 10, font });
    const bytes = await doc.save();
    const before = bytes.slice().buffer as ArrayBuffer;

    const originals = await listPageTextShows(before, 1);
    expect(originals.map((show) => show.text)).toEqual(["Paid To", "500.00", "1,200.00"]);
    const right = Math.max(
      ...originals.map((show) => show.x + font.widthOfTextAtSize(show.text, 10)),
    );

    const aligned = await applyTextPatchesWithReport(
      before,
      originals.map((show) => ({
        page: 1,
        x: show.x,
        y: show.y,
        width: font.widthOfTextAtSize(show.text, 10),
        height: 12,
        fontSize: 10,
        text: show.text,
        originalText: show.text,
        fontFamily: "Helvetica",
        targetX: right - font.widthOfTextAtSize(show.text, 10),
        targetY: show.y,
      })),
    );
    const moved = await listPageTextShows(aligned.bytes.slice().buffer as ArrayBuffer, 1);
    expect(moved.map((show) => show.text)).toEqual(["Paid To", "500.00", "1,200.00"]);
    const rights = moved.map((show) => show.x + font.widthOfTextAtSize(show.text, 10));
    expect(Math.max(...rights) - Math.min(...rights)).toBeLessThan(0.2);
    expect(moved.map((show) => show.x)).not.toEqual(originals.map((show) => show.x));

    const snapped = await applyTextPatchesWithReport(
      aligned.bytes.slice().buffer as ArrayBuffer,
      moved.map((show, index) => ({
        page: 1,
        x: show.x,
        y: show.y,
        width: font.widthOfTextAtSize(show.text, 10),
        height: 12,
        fontSize: 10,
        text: show.text,
        originalText: show.text,
        fontFamily: "Helvetica",
        targetX: originals[index]!.x,
        targetY: originals[index]!.y,
      })),
    );
    const restored = await listPageTextShows(snapped.bytes.slice().buffer as ArrayBuffer, 1);
    restored.forEach((show, index) => {
      expect(show.x).toBeCloseTo(originals[index]!.x, 1);
      expect(show.y).toBeCloseTo(originals[index]!.y, 1);
    });
  });
});
