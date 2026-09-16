import { describe, expect, it } from "vitest";
import {
  assertPageOrder,
  identityOrder,
  isIdentityOrder,
  moveIndex,
  refsFromSlots,
  slotsFromPdfs,
  slotsMatchFileOrder,
  type NamedPdf,
} from "./page-order";

function fakePdf(name: string, pages: number, tag: number): NamedPdf {
  return { name, bytes: new ArrayBuffer(tag), pages };
}

describe("page order helpers", () => {
  it("builds 1-based identity order", () => {
    expect(identityOrder(3)).toEqual([1, 2, 3]);
    expect(isIdentityOrder([1, 2, 3])).toBe(true);
    expect(isIdentityOrder([3, 1, 2])).toBe(false);
  });

  it("moves the last page to the front: 1-2-3 → 3-1-2", () => {
    expect(moveIndex([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });

  it("moves a middle page down with up/down-style ±1 steps", () => {
    const afterLeft = moveIndex(["a", "b", "c"], 1, 0);
    expect(afterLeft).toEqual(["b", "a", "c"]);
    expect(moveIndex(afterLeft, 0, 1)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op for out-of-range indices", () => {
    expect(moveIndex([1, 2, 3], -1, 0)).toEqual([1, 2, 3]);
    expect(moveIndex([1, 2, 3], 0, 9)).toEqual([1, 2, 3]);
    expect(moveIndex([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
  });

  it("rejects orders that drop, duplicate, or invent pages", () => {
    expect(() => assertPageOrder([3, 1], 3)).toThrow(/all 3 pages/i);
    expect(() => assertPageOrder([3, 1, 1], 3)).toThrow(/twice/i);
    expect(() => assertPageOrder([3, 1, 4], 3)).toThrow(/outside/i);
    expect(assertPageOrder([3, 1, 2], 3)).toEqual([3, 1, 2]);
  });

  it("expands merged files into slots in file order", () => {
    const files = [fakePdf("a.pdf", 2, 1), fakePdf("b.pdf", 1, 2)];
    const slots = slotsFromPdfs(files);
    expect(slots.map((s) => `${s.sourceName}:${s.sourcePage}`)).toEqual([
      "a.pdf:1",
      "a.pdf:2",
      "b.pdf:1",
    ]);
    expect(slotsMatchFileOrder(slots, files)).toBe(true);
    const reordered = moveIndex(slots, 2, 0);
    expect(slotsMatchFileOrder(reordered, files)).toBe(false);
    expect(refsFromSlots(reordered).map((r) => r.page)).toEqual([1, 1, 2]);
  });
});
