import { describe, expect, it } from "vitest";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildSamplePdf } from "./pdf-tools";
import {
  extractLines,
  expandToFullLine,
  groupTextItems,
  looksGarbled,
  mergeLinesByBaseline,
  onSameVisualRow,
  preferReadableText,
  joinRunsToLine,
  splitLineByColumnShows,
  type RawTextItem,
  type TextLine,
} from "./pdf-runtime";
import {
  applyTextPatchesWithReport,
  inspectTextPatch,
  listPageShownText,
  listPageTextShows,
} from "./pdf-text-edit";
import { columnFieldsForLine, membersForLinePatch } from "./edit-apply";
import { patchesFromEdit } from "./text-align";

GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function assemblePdf(objects: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let length = parts[0]!.length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(length);
    const chunk = encoder.encode(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
    parts.push(chunk);
    length += chunk.length;
  }
  const xrefStart = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const tail = encoder.encode(
    `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );
  parts.push(tail);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Helvetica with a custom Encoding so stream bytes ≠ ToUnicode. */
function buildCustomEncodingPdf(): Uint8Array {
  const visual = "Paid To - Synchrony card";
  const names = [...visual].map((ch) => {
    if (ch === " ") return "/space";
    if (ch === "-") return "/hyphen";
    return `/${ch}`;
  });
  const codes = [...visual].map((_, i) => String.fromCharCode(65 + i)).join("");
  const splitAt = visual.indexOf("Synchrony");
  const first = codes.slice(0, splitAt);
  const second = codes.slice(splitAt);
  const stream = `BT\n/F1 12 Tf\n1 0 0 1 50 120 Tm (${first}) Tj\n1 0 0 1 140 120 Tm (${second}) Tj\nET\n`;
  const streamObj = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  return assemblePdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    streamObj,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 6 0 R >>",
    `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 ${names.join(" ")}] >>`,
  ]);
}

describe("preferReadableText", () => {
  it("uses PDF.js Unicode when the stream decode is CID mojibake", () => {
    const stream = "3DLG 7R 6\\QFKURQ\\ FDUG 6\\G 3D\\ &KN";
    const visual = "Paid To - Synchrony card Syd Pay";
    expect(looksGarbled(stream)).toBe(true);
    expect(looksGarbled(visual)).toBe(false);
    expect(preferReadableText(stream, visual)).toBe(visual);
  });

  it("keeps a readable stream amount when PDF.js dropped the comma", () => {
    expect(preferReadableText("2,500.00", "2 500.00")).toBe("2,500.00");
    expect(preferReadableText("2,500.00", "2500.00")).toBe("2,500.00");
  });
});

describe("mergeLinesByBaseline", () => {
  it("merges tiny same-baseline fragments into one selectable line", () => {
    const item = (str: string, x: number, w: number, fontName = "F1"): RawTextItem => ({
      str,
      x,
      y: 400,
      w,
      h: 9,
      fontName,
      fontFamily: "Helvetica",
    });
    const runs = groupTextItems(
      [
        item("06-08", 56, 28),
        item("Paid To -", 90, 44),
        item("Synchrony card", 140, 72),
        item("Syd Pay", 218, 40),
        item("500.00", 500, 36, "F2"),
      ],
      1,
    );
    expect(runs.length).toBeGreaterThan(1);
    const lines = mergeLinesByBaseline(runs);
    const row = lines.find((line) => line.text.includes("Synchrony"));
    expect(row?.text).toMatch(/06-08/);
    expect(row?.text).toMatch(/Synchrony card/);
    expect(row?.text).toMatch(/Syd Pay/);
    expect(row?.width ?? 0).toBeGreaterThan(180);
    const amount = lines.find((line) => line.text.includes("500.00"));
    expect(amount?.text).toBe("500.00");
    const expanded = expandToFullLine(lines, row!);
    expect(expanded?.text).toMatch(/500\.00/);
    expect(expanded?.text).toMatch(/Syd Pay 500\.00/);
  });

  it("splits a fat statement row into column members from content-stream shows", () => {
    const line = joinRunsToLine([
      {
        id: "row",
        page: 1,
        text: "European oak worktop, 40mm 3 12 35",
        x: 56,
        y: 640,
        width: 445,
        height: 12,
        fontSize: 10,
        fontName: "F1",
        fontFamily: "Helvetica",
        kind: "run",
        source: "pdfjs",
        hasTextOperator: true,
      },
    ]);
    const split = splitLineByColumnShows(line, [
      { text: "European oak worktop, 40mm", x: 56, y: 640, fontSize: 10 },
      { text: "3", x: 360, y: 640, fontSize: 10 },
      { text: "12", x: 420, y: 640, fontSize: 10 },
      { text: "35", x: 490, y: 640, fontSize: 10 },
    ]);
    expect(split.members?.length).toBe(4);
    expect(split.members?.map((member) => member.x)).toEqual([56, 360, 420, 490]);
    expect(split.members?.every((member) => member.originX === member.x)).toBe(true);
  });

  it("joins a split description without swallowing the amount column", () => {
    const runs = groupTextItems(
      [
        {
          str: "06-06 Paid From - Synchrony card Syf",
          x: 50,
          y: 640,
          w: 80,
          h: 8,
          fontName: "F1",
          fontFamily: "Helvetica",
        },
        {
          str: "Paymnt Chk 4220268",
          x: 180,
          y: 640,
          w: 90,
          h: 8,
          fontName: "F1",
          fontFamily: "Helvetica",
        },
        { str: "500.00", x: 400, y: 640, w: 40, h: 8, fontName: "F2", fontFamily: "Helvetica" },
        { str: "4,972.29", x: 500, y: 640, w: 44, h: 8, fontName: "F2", fontFamily: "Helvetica" },
      ],
      1,
    );
    const lines = mergeLinesByBaseline(runs);
    const desc = lines.find((line) => /Paid From/.test(line.text));
    expect(desc?.text).toMatch(/Paymnt Chk 4220268/);
    expect(desc?.text).not.toMatch(/500\.00/);
    expect(lines.find((line) => line.text === "500.00")?.x).toBe(400);
    expect(lines.find((line) => line.text === "4,972.29")?.x).toBe(500);
    const expanded = expandToFullLine(lines, desc!);
    const fields = columnFieldsForLine(expanded ?? desc!);
    expect(fields.map((field) => field.label)).toEqual(["Description", "Amount", "Balance"]);
    expect(fields[0]?.text).toMatch(/Paymnt Chk 4220268/);
    expect(fields[1]?.x).toBe(400);
    expect(fields[2]?.x).toBe(500);
  });

  it("expandToFullLine still joins amount columns when PDF.js y drifted after a rewrite", () => {
    const run = (
      partial: Pick<TextLine, "id" | "text" | "x" | "y"> & Partial<TextLine>,
    ): TextLine => ({
      page: 1,
      width: 40,
      height: 10,
      fontSize: 8,
      fontName: "F1",
      fontFamily: "Helvetica",
      kind: "run",
      source: "pdfjs",
      hasTextOperator: true,
      originX: partial.x,
      originY: 700,
      ...partial,
    });
    const desc = run({
      id: "desc",
      text: "05-22 Paid From - Applecard Gsbank Payment Chk 12408508",
      x: 14,
      y: 695.2,
      width: 220,
      originY: 700,
    });
    const amount = run({
      id: "amt",
      text: "250.00-",
      x: 409,
      y: 700,
      width: 40,
      originY: 700,
    });
    const balance = run({
      id: "bal",
      text: "1,834.34",
      x: 517,
      y: 700.1,
      width: 44,
      originY: 700,
    });
    const other = run({
      id: "next",
      text: "05-23 Paid To - Other Merchant",
      x: 14,
      y: 688,
      width: 180,
      originY: 688,
    });
    expect(onSameVisualRow(desc, amount)).toBe(true);
    expect(onSameVisualRow(desc, other)).toBe(false);
    const expanded = expandToFullLine([desc, amount, balance, other], desc);
    const members = (expanded?.members ?? []).filter((member) => member.text.trim());
    expect(members.map((member) => member.text)).toEqual([
      "05-22 Paid From - Applecard Gsbank Payment Chk 12408508",
      "250.00-",
      "1,834.34",
    ]);
    expect(members.find((member) => member.text === "250.00-")?.x).toBe(409);
    expect(members.find((member) => member.text === "1,834.34")?.x).toBe(517);
    const merged = mergeLinesByBaseline([desc, amount, balance, other]);
    const apple = merged.find((line) => /Applecard/.test(line.text));
    const full = expandToFullLine(merged, apple!) ?? apple;
    expect((full?.members ?? []).filter((member) => member.text.trim())).toHaveLength(3);
  });

  it("keeps a space when a far amount is merged despite an over-wide label box", () => {
    const joined = joinRunsToLine([
      {
        id: "a",
        page: 1,
        text: "Card 6205 POS debit",
        x: 56,
        y: 710,
        width: 400,
        height: 13,
        fontSize: 11,
        fontName: "F1",
        fontFamily: "Helvetica",
        kind: "run",
      },
      {
        id: "b",
        page: 1,
        text: "2,500.00",
        x: 420,
        y: 710,
        width: 44,
        height: 13,
        fontSize: 11,
        fontName: "F2",
        fontFamily: "Helvetica",
        kind: "run",
      },
    ]);
    expect(joined.text).toBe("Card 6205 POS debit 2,500.00");
  });

  it("joins overlapping glyph fragments that used to stay tiny", () => {
    const lines = groupTextItems(
      [
        { str: "Pa", x: 56, y: 400, w: 11, h: 10, fontName: "F1", fontFamily: "Helvetica" },
        { str: "id", x: 64, y: 400, w: 10, h: 10, fontName: "F1", fontFamily: "Helvetica" },
        { str: "To", x: 80, y: 400.4, w: 14, h: 10, fontName: "F1", fontFamily: "Helvetica" },
      ],
      1,
    );
    expect(mergeLinesByBaseline(lines)).toHaveLength(1);
    expect(mergeLinesByBaseline(lines)[0]?.text).toMatch(/Paid To/);
  });
});

describe("expandToFullLine", () => {
  it("returns an already-complete 3-member columnar row instead of null", () => {
    const member = (
      id: string,
      text: string,
      x: number,
      width: number,
      fontName = "F1",
    ): TextLine => ({
      id,
      page: 1,
      text,
      x,
      y: 640,
      width,
      height: 13,
      fontSize: 11,
      fontName,
      fontFamily: "Helvetica",
      kind: "run",
    });
    const line = joinRunsToLine([
      member("desc", "06-08 Paid To - Synchrony card Syd Pay", 56, 320),
      member("amt", "500.00", 430, 44, "F2"),
      member("bal", "4,972.29", 546, 44, "F2"),
    ]);
    expect(line.members).toHaveLength(3);
    expect(line.width).toBeCloseTo(534, 0);

    const expanded = expandToFullLine([line], line);
    expect(expanded).not.toBeNull();
    expect(expanded).toBe(line);
    expect(expanded?.members).toHaveLength(3);
    expect(expanded?.text).toBe(line.text);
    expect(expanded?.width).toBeCloseTo(534, 0);
  });
});

describe("extractLines vs content stream", () => {
  it("keeps the thousands comma on the sample total", async () => {
    const bytes = await buildSamplePdf();
    const buf = bytes.slice().buffer as ArrayBuffer;
    const shown = await listPageShownText(buf, 1);
    expect(shown).toContain("1,987.00");

    const proxy = await getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const page = await proxy.getPage(1);
    const combined = await page.getTextContent({ disableNormalization: true });
    const combinedStrs = combined.items
      .map((i) => ("str" in i ? i.str : ""))
      .filter((s) => /1987|1,987|987/.test(s));
    expect(combinedStrs.length).toBeGreaterThan(0);
    expect(combinedStrs.join("|")).toContain("1,987.00");
    const lines = await extractLines(proxy, 1, buf);
    const texts = lines.map((l) => l.text);
    expect(texts.some((t) => t.includes("1,987.00"))).toBe(true);
    expect(texts.some((t) => t === "1987.00")).toBe(false);
  });

  it("keeps commas on the comma-amounts fixture and maps a statement fragment", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const buf = await readFile(join(process.cwd(), "fixtures/comma-amounts.pdf"));
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const shown = await listPageShownText(bytes, 1);
    expect(shown).toContain("2,500.00");
    expect(shown.some((t) => t.includes("POS Debit- Debit Card 6205"))).toBe(true);

    const proxy = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
    const lines = await extractLines(proxy, 1, bytes);
    const texts = lines.map((l) => l.text);
    expect(texts.some((t) => t.includes("2,500.00"))).toBe(true);
    expect(texts.some((t) => t.includes("1,987.00"))).toBe(true);
    expect(texts.some((t) => t.includes("POS Debit"))).toBe(true);
    expect(texts.some((t) => t === "2500.00" || t === "2 500.00")).toBe(false);
  });

  it("surfaces ToUnicode in the editor when stream bytes are a custom encoding", async () => {
    const bytes = buildCustomEncodingPdf();
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const shown = await listPageShownText(buf, 1);
    expect(shown.join("")).toMatch(/ABCDEFGHIJKLMNOPQRSTUVWX/);
    expect(shown.join("")).not.toMatch(/Synchrony/);

    const proxy = await getDocument({ data: new Uint8Array(bytes) }).promise;
    const page = await proxy.getPage(1);
    const content = await page.getTextContent({ disableNormalization: true });
    const visual = content.items.map((item) => ("str" in item ? item.str : "")).join("");
    expect(visual.replace(/\s+/g, " ")).toMatch(/Paid To/);
    expect(visual.replace(/\s+/g, " ")).toMatch(/Synchrony/);

    const lines = await extractLines(proxy, 1, buf);
    const row = lines.find((line) => /Paid To/.test(line.text) || /Synchrony/.test(line.text));
    expect(row).toBeTruthy();
    expect(row?.text).toMatch(/Paid To/);
    expect(row?.text).toMatch(/Synchrony/);
    expect(row?.text).not.toMatch(/ABCDEF/);
    expect(row?.rawText).toMatch(/ABCDEFGHIJKLMNOPQRSTUVWX/);
    expect(row?.width ?? 0).toBeGreaterThan(80);

    const inspection = await inspectTextPatch(buf, {
      page: 1,
      x: row!.x,
      y: row!.y,
      width: row!.width,
      height: row!.height,
      fontSize: row!.fontSize,
      text: "Paid To - Relief card",
      originalText: row!.text,
      rawText: row!.rawText,
      fontFamily: "HelveticaNeueWorld-55R",
    });
    expect(inspection.found).toBe(true);
    expect(inspection.method).not.toBe("blocked");
    expect(inspection.message).not.toMatch(/must buy|purchase Creative Cloud/i);

    const { bytes: out, reports } = await applyTextPatchesWithReport(buf, [
      {
        page: 1,
        x: row!.x,
        y: row!.y,
        width: row!.width,
        height: row!.height,
        fontSize: row!.fontSize,
        text: "Paid To - Relief card",
        originalText: row!.text,
        rawText: row!.rawText,
        fontFamily: "HelveticaNeueWorld-55R",
      },
    ]);
    expect(reports[0]?.method).not.toBe("blocked");
    const afterProxy = await getDocument({ data: new Uint8Array(out) }).promise;
    const afterContent = await (
      await afterProxy.getPage(1)
    ).getTextContent({
      disableNormalization: true,
    });
    const afterVisual = afterContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    expect(afterVisual).toMatch(/Relief/);
    expect(afterVisual).not.toMatch(/ABCDEFGHIJKLMNOPQRSTUVWX/);
  });

  it("keeps statement amount columns at their x after a description-only apply", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText("06-06 Paid To - Synchrony card Syf Paymnt Chk 4220268", {
      x: 50,
      y: 700,
      size: 8,
      font,
    });
    page.drawText("500.00", { x: 400, y: 700, size: 8, font: bold });
    page.drawText("4,972.29", { x: 500, y: 700, size: 8, font: bold });
    const bytes = (await doc.save()).slice().buffer as ArrayBuffer;
    const proxy = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
    const lines = await extractLines(proxy, 1, bytes);
    const desc = lines.find((line) => /Paid To/.test(line.text));
    expect(desc).toBeTruthy();
    expect(desc?.text).not.toMatch(/500\.00/);
    const expanded = expandToFullLine(lines, desc!);
    const row = expanded ?? desc!;
    const fields = columnFieldsForLine(row);
    expect(fields.length).toBeGreaterThanOrEqual(2);
    expect(fields[0]?.label).toBe("Description");
    expect(fields.some((field) => /Amount|Balance/.test(field.label))).toBe(true);
    const members = membersForLinePatch(
      row,
      Object.fromEntries(
        fields.map((field) => [
          field.id,
          field.label === "Description" ? field.text.replace("Paid To", "Paid From") : field.text,
        ]),
      ),
    );
    const { bytes: out } = await applyTextPatchesWithReport(bytes, [
      {
        page: 1,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        fontSize: row.fontSize,
        text: "06-06 Paid From - Synchrony card Syf Paymnt Chk 4220268 500.00 4,972.29",
        originalText: row.text,
        fontFamily: "Helvetica",
        ...(members ? { members } : {}),
      },
    ]);
    const after = await listPageTextShows(out.slice().buffer as ArrayBuffer, 1);
    expect(after.find((show) => /Paid From/.test(show.text))?.x).toBeCloseTo(50, 1);
    expect(after.find((show) => show.text === "500.00")?.x).toBeCloseTo(400, 1);
    expect(after.find((show) => show.text === "4,972.29")?.x).toBeCloseTo(500, 1);
    expect(after.some((show) => /Paid To/.test(show.text))).toBe(false);
  });

  it("extractLines still sees amount+balance after a description-only June-like edit", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const desc = "05-22 Paid To - Applecard Gsbank Payment Chk 12408508";
    page.drawText(desc, { x: 14, y: 700, size: 8, font });
    page.drawText("250.00-", { x: 409, y: 700, size: 8, font: bold });
    page.drawText("1,834.34", { x: 517, y: 700, size: 8, font: bold });
    page.drawText("05-23 Paid To - Other Merchant Chk 9999", { x: 14, y: 680, size: 8, font });
    page.drawText("10.00-", { x: 409, y: 680, size: 8, font: bold });
    page.drawText("2,084.34", { x: 517, y: 680, size: 8, font: bold });
    const bytes = (await doc.save()).slice().buffer as ArrayBuffer;
    const proxy = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
    const lines = await extractLines(proxy, 1, bytes);
    const apple = lines.find((line) => /Applecard/.test(line.text));
    expect(apple).toBeTruthy();
    const expanded = expandToFullLine(lines, apple!) ?? apple!;
    const fields = columnFieldsForLine(expanded);
    expect(fields.map((field) => field.label)).toEqual(["Description", "Amount", "Balance"]);
    const descField = fields.find((field) => field.label === "Description");
    expect(descField).toBeTruthy();
    const patches = patchesFromEdit({
      line: expanded,
      text: expanded.text.replace("Paid To", "Paid From"),
      memberTexts: {
        [descField!.id]: descField!.text.replace("Paid To", "Paid From"),
      },
    });
    expect(patches).toHaveLength(1);
    const { bytes: out } = await applyTextPatchesWithReport(bytes, patches);
    const afterProxy = await getDocument({ data: new Uint8Array(out) }).promise;
    const afterLines = await extractLines(afterProxy, 1, out.slice().buffer as ArrayBuffer);
    const afterApple = afterLines.find((line) => /Applecard/.test(line.text));
    expect(afterApple).toBeTruthy();
    const afterRow = expandToFullLine(afterLines, afterApple!);
    expect(afterRow).toBeTruthy();
    const members = (afterRow?.members ?? []).filter((member) => member.text.trim());
    expect(members).toHaveLength(3);
    expect(members.find((member) => /Paid From/.test(member.text))?.x).toBeCloseTo(14, 1);
    expect(members.find((member) => member.text === "250.00-")?.x).toBeCloseTo(409, 1);
    expect(members.find((member) => member.text === "1,834.34")?.x).toBeCloseTo(517, 1);
    expect(afterRow?.text).toMatch(/Paid From/);
    expect(afterRow?.text).toMatch(/250\.00-/);
    expect(afterRow?.text).toMatch(/1,834\.34/);
    expect(afterRow?.text).not.toMatch(/Paid To/);
    const afterFields = columnFieldsForLine(afterRow!);
    expect(afterFields.map((field) => field.label)).toEqual(["Description", "Amount", "Balance"]);
    const shows = await listPageTextShows(out.slice().buffer as ArrayBuffer, 1);
    const onApple = shows.filter((show) => Math.abs(show.y - 700) < 2);
    expect(onApple.find((show) => show.text === "250.00-")?.x).toBeCloseTo(409, 1);
    expect(onApple.find((show) => show.text === "1,834.34")?.x).toBeCloseTo(517, 1);
  });
});
