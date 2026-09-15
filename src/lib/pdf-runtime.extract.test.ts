import { describe, expect, it } from "vitest";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { buildSamplePdf } from "./pdf-tools";
import {
  extractLines,
  expandToFullLine,
  groupTextItems,
  looksGarbled,
  mergeLinesByBaseline,
  preferReadableText,
  type RawTextItem,
} from "./pdf-runtime";
import { applyTextPatchesWithReport, inspectTextPatch, listPageShownText } from "./pdf-text-edit";

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
});
