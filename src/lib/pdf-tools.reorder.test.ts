import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listPageShownText } from "./pdf-text-edit";
import {
  copyPagesInOrder,
  extractPages,
  getPageCount,
  listPageRotations,
  mergeFiles,
  moveIndex,
  reorderPages,
  rotatePagesBy,
} from "./pdf-tools";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

function load(name: string): ArrayBuffer {
  const buf = readFileSync(join(fixtures, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function snapshot(bytes: ArrayBuffer): Uint8Array {
  return new Uint8Array(bytes.slice(0));
}

async function markerOnPage(bytes: Uint8Array, page: number): Promise<string> {
  const shown = await listPageShownText(asBuffer(bytes), page);
  const hit = shown.find((text) => /PAGE_MARKER_\d/.test(text));
  return hit ?? shown.join(" ");
}

describe("reorder pages", () => {
  it("rewrites multi-page.pdf as 3-1-2 and leaves the source bytes untouched", async () => {
    const source = load("multi-page.pdf");
    const before = snapshot(source);
    expect(await getPageCount(source)).toBe(3);
    expect(await markerOnPage(before, 1)).toContain("PAGE_MARKER_1");
    expect(await markerOnPage(before, 2)).toContain("PAGE_MARKER_2");
    expect(await markerOnPage(before, 3)).toContain("PAGE_MARKER_3");

    const order = moveIndex([1, 2, 3], 2, 0);
    expect(order).toEqual([3, 1, 2]);
    const out = await reorderPages(source, order, "multi-page");

    expect(out.pages).toBe(3);
    expect(out.name).toBe("multi-page-reordered.pdf");
    expect(await getPageCount(asBuffer(out.bytes))).toBe(3);
    expect(await markerOnPage(out.bytes, 1)).toContain("PAGE_MARKER_3");
    expect(await markerOnPage(out.bytes, 2)).toContain("PAGE_MARKER_1");
    expect(await markerOnPage(out.bytes, 3)).toContain("PAGE_MARKER_2");
    expect(snapshot(source)).toEqual(before);
  });

  it("reorders a merged file the same way", async () => {
    const multi = load("multi-page.pdf");
    const simple = load("simple-text.pdf");
    const beforeMulti = snapshot(multi);
    const beforeSimple = snapshot(simple);

    const merged = await mergeFiles([
      { name: "multi-page.pdf", bytes: multi },
      { name: "simple-text.pdf", bytes: simple },
    ]);
    expect(merged.pages).toBe(4);

    const mergedBuf = asBuffer(merged.bytes);
    const out = await reorderPages(mergedBuf, [3, 1, 2, 4], "merged");
    expect(out.pages).toBe(4);
    expect(await markerOnPage(out.bytes, 1)).toContain("PAGE_MARKER_3");
    expect(await markerOnPage(out.bytes, 2)).toContain("PAGE_MARKER_1");
    expect(await markerOnPage(out.bytes, 3)).toContain("PAGE_MARKER_2");
    const last = await listPageShownText(asBuffer(out.bytes), 4);
    expect(last.join(" ")).toMatch(/REPLACE_ME/);
    expect(snapshot(multi)).toEqual(beforeMulti);
    expect(snapshot(simple)).toEqual(beforeSimple);
  });

  it("copyPagesInOrder can stitch pages from two files without a prior merge", async () => {
    const multi = load("multi-page.pdf");
    const simple = load("simple-text.pdf");
    const out = await copyPagesInOrder(
      [
        { bytes: multi, page: 3 },
        { bytes: simple, page: 1 },
        { bytes: multi, page: 1 },
      ],
      "packet.pdf",
    );
    expect(out.pages).toBe(3);
    expect(out.name).toBe("packet.pdf");
    expect(await markerOnPage(out.bytes, 1)).toContain("PAGE_MARKER_3");
    const middle = await listPageShownText(asBuffer(out.bytes), 2);
    expect(middle.join(" ")).toMatch(/REPLACE_ME/);
    expect(await markerOnPage(out.bytes, 3)).toContain("PAGE_MARKER_1");
  });

  it("rejects a partial order so extract or delete is used to drop pages", async () => {
    const source = load("multi-page.pdf");
    await expect(reorderPages(source, [3, 1], "multi-page")).rejects.toThrow(/all 3 pages/i);
    const extracted = await extractPages(source, "multi-page", [3, 1]);
    expect(extracted.pages).toBe(2);
    expect(await markerOnPage(extracted.bytes, 1)).toContain("PAGE_MARKER_3");
    expect(await markerOnPage(extracted.bytes, 2)).toContain("PAGE_MARKER_1");
  });

  it("keeps /Rotate on a page when that page is moved in a 3-1-2 reorder", async () => {
    const source = load("multi-page.pdf");
    const before = snapshot(source);
    const rotated = await rotatePagesBy(source, [2], 90);
    expect(await listPageRotations(asBuffer(rotated))).toEqual([0, 90, 0]);
    const out = await reorderPages(asBuffer(rotated), [3, 1, 2], "multi-page");
    expect(await markerOnPage(out.bytes, 1)).toContain("PAGE_MARKER_3");
    expect(await markerOnPage(out.bytes, 2)).toContain("PAGE_MARKER_1");
    expect(await markerOnPage(out.bytes, 3)).toContain("PAGE_MARKER_2");
    expect(await listPageRotations(asBuffer(out.bytes))).toEqual([0, 0, 90]);
    expect(snapshot(source)).toEqual(before);
  });
});
