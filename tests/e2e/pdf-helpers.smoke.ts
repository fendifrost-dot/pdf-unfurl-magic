/**
 * Optional Vitest path — imports the real pdf-lib helpers.
 * See tests/e2e/README.md. Not run by `npm run test:smoke`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyTextPatches,
  extractPages,
  getPageCount,
  mergeFiles,
  rotatePagesBy,
  listPageRotations,
} from "../../src/lib/pdf-tools";
import { bytesToArrayBuffer } from "../../src/lib/pdf-io";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

function load(name: string): ArrayBuffer {
  const buf = readFileSync(join(fixtures, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("pdf helpers × fixtures", () => {
  it("loads multi-page and reports 3 pages", async () => {
    expect(await getPageCount(load("multi-page.pdf"))).toBe(3);
  });

  it("extracts two pages and keeps export size sane", async () => {
    const source = load("multi-page.pdf");
    const out = await extractPages(source, "multi-page", [1, 3]);
    expect(out.pages).toBe(2);
    expect(out.bytes.byteLength).toBeGreaterThan(200);
    expect(out.bytes.byteLength).toBeLessThan(source.byteLength);
  });

  it("merges simple-text + multi-page → 4 pages", async () => {
    const out = await mergeFiles([
      { name: "simple-text.pdf", bytes: load("simple-text.pdf") },
      { name: "multi-page.pdf", bytes: load("multi-page.pdf") },
    ]);
    expect(out.pages).toBe(4);
    expect(out.bytes.byteLength).toBeGreaterThan(400);
    expect(out.bytes.byteLength).toBeLessThan(40_000);
  });

  it("applyTextPatches export stays in a sane size band", async () => {
    const source = load("simple-text.pdf");
    const bytes = await applyTextPatches(source, [
      { page: 1, x: 56, y: 710, width: 240, height: 14, fontSize: 12, text: "VITEST_PATCH" },
    ]);
    expect(bytes.byteLength).toBeGreaterThan(200);
    expect(bytes.byteLength).toBeLessThan(source.byteLength * 3);
  });

  it("rotates page 2 of multi-page by 90° and leaves 1 and 3 at 0", async () => {
    const source = load("multi-page.pdf");
    const bytes = await rotatePagesBy(source, [2], 90);
    expect(await listPageRotations(bytesToArrayBuffer(bytes))).toEqual([0, 90, 0]);
  });
});
