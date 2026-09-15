import { describe, expect, it } from "vitest";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { buildSamplePdf } from "./pdf-tools";
import { extractLines } from "./pdf-runtime";
import { listPageShownText } from "./pdf-text-edit";

GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

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
    expect(texts).toContain("1,987.00");
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
    expect(texts).toContain("2,500.00");
    expect(texts).toContain("1,987.00");
    expect(texts.some((t) => t.includes("POS Debit"))).toBe(true);
    expect(texts.some((t) => t === "2500.00" || t === "2 500.00")).toBe(false);
  });
});
