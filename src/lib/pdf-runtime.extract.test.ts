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
});
