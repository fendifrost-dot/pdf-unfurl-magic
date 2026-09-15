import { describe, expect, it, vi } from "vitest";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSamplePdf } from "./pdf-tools";
import { extractLines } from "./pdf-runtime";

vi.mock("./pdf-text-edit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pdf-text-edit")>();
  return {
    ...actual,
    listPageTextShows: async () => [],
  };
});

GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

describe("extractLines when the stream walker finds no shows", () => {
  it("keeps PDF.js Unicode lines instead of returning an empty overlay", async () => {
    const bytes = await buildSamplePdf();
    const buf = bytes.slice().buffer as ArrayBuffer;
    const proxy = await getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const lines = await extractLines(proxy, 1, buf);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => /Northgate|1,987|Total due/i.test(line.text))).toBe(true);
  });

  it("still returns no lines for a true image-only scan", async () => {
    const buf = await readFile(join(process.cwd(), "fixtures/scan-image-only.pdf"));
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const proxy = await getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
    const lines = await extractLines(proxy, 1, bytes);
    expect(lines).toEqual([]);
  });
});
