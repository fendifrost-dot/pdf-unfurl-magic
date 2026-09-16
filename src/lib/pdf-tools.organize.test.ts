import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PdfEncryptedMutationError } from "./pdf-io";
import { buildPasswordOpenPdf } from "./pdf-password-fixture";
import { listPageShownText } from "./pdf-text-edit";
import {
  copyPagesInOrder,
  deletePages,
  extractPages,
  getPageCount,
  refsFromSlots,
} from "./pdf-tools";
import { slotsAfterDelete, slotsForExtract, slotsFromPdf } from "./page-order";

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

describe("extract selected pages", () => {
  it("extracts page 2 of multi-page.pdf as PAGE_MARKER_2 and leaves the source untouched", async () => {
    const source = load("multi-page.pdf");
    const before = snapshot(source);
    const slots = slotsFromPdf({ name: "multi-page.pdf", bytes: source, pages: 3 });
    const picked = slotsForExtract(slots, new Set([slots[1]!.id]));
    const out = await copyPagesInOrder(refsFromSlots(picked), "multi-page-extract.pdf");

    expect(out.pages).toBe(1);
    expect(out.name).toBe("multi-page-extract.pdf");
    expect(await getPageCount(asBuffer(out.bytes))).toBe(1);
    expect(await markerOnPage(out.bytes, 1)).toContain("PAGE_MARKER_2");
    expect(await markerOnPage(out.bytes, 1)).not.toContain("PAGE_MARKER_1");
    expect(await markerOnPage(out.bytes, 1)).not.toContain("PAGE_MARKER_3");
    expect(snapshot(source)).toEqual(before);

    const viaHelper = await extractPages(source, "multi-page", [2]);
    expect(viaHelper.pages).toBe(1);
    expect(viaHelper.name).toBe("multi-page-extract.pdf");
    expect(await markerOnPage(viaHelper.bytes, 1)).toContain("PAGE_MARKER_2");
    expect(snapshot(source)).toEqual(before);
  });

  it("extracts selected pages in current strip order after a 3-1-2 reorder", async () => {
    const source = load("multi-page.pdf");
    const slots = slotsFromPdf({ name: "multi-page.pdf", bytes: source, pages: 3 });
    const reordered = [slots[2]!, slots[0]!, slots[1]!];
    const picked = slotsForExtract(reordered, new Set([reordered[0]!.id, reordered[2]!.id]));
    const out = await copyPagesInOrder(refsFromSlots(picked), "multi-page-extract.pdf");
    expect(out.pages).toBe(2);
    expect(await markerOnPage(out.bytes, 1)).toContain("PAGE_MARKER_3");
    expect(await markerOnPage(out.bytes, 2)).toContain("PAGE_MARKER_2");
  });
});

describe("delete selected pages", () => {
  it("deletes page 2 of multi-page.pdf then remaining markers are 1 then 3", async () => {
    const source = load("multi-page.pdf");
    const before = snapshot(source);
    const slots = slotsFromPdf({ name: "multi-page.pdf", bytes: source, pages: 3 });
    const remaining = slotsAfterDelete(slots, new Set([slots[1]!.id]));
    const out = await copyPagesInOrder(refsFromSlots(remaining), "multi-page-pages.pdf");

    expect(out.pages).toBe(2);
    expect(out.name).toBe("multi-page-pages.pdf");
    expect(await getPageCount(asBuffer(out.bytes))).toBe(2);
    expect(await markerOnPage(out.bytes, 1)).toContain("PAGE_MARKER_1");
    expect(await markerOnPage(out.bytes, 2)).toContain("PAGE_MARKER_3");
    expect(await markerOnPage(out.bytes, 1)).not.toContain("PAGE_MARKER_2");
    expect(snapshot(source)).toEqual(before);

    const viaHelper = await deletePages(source, [2], "multi-page");
    expect(viaHelper.pages).toBe(2);
    expect(viaHelper.name).toBe("multi-page-pages.pdf");
    expect(await markerOnPage(viaHelper.bytes, 1)).toContain("PAGE_MARKER_1");
    expect(await markerOnPage(viaHelper.bytes, 2)).toContain("PAGE_MARKER_3");
    expect(snapshot(source)).toEqual(before);
  });

  it("refuses to delete every page", async () => {
    const source = load("multi-page.pdf");
    await expect(deletePages(source, [1, 2, 3], "multi-page")).rejects.toThrow(
      /keep at least one page/i,
    );
    await expect(deletePages(source, [], "multi-page")).rejects.toThrow(
      /select at least one page to delete/i,
    );
  });

  it("will not extract or delete pages from an encrypted file", async () => {
    const encrypted = asBuffer(buildPasswordOpenPdf());
    await expect(extractPages(encrypted, "locked", [1])).rejects.toBeInstanceOf(
      PdfEncryptedMutationError,
    );
    await expect(deletePages(encrypted, [1], "locked")).rejects.toBeInstanceOf(
      PdfEncryptedMutationError,
    );
  });
});
