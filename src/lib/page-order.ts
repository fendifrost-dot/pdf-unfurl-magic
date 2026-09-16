/**
 * Page-order helpers for Organize Pages / merge reorder.
 * Pure functions — the pdf-lib copy lives in pdf-tools.
 */

/** 1-based [1, 2, …, n]. */
export function identityOrder(pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 0) {
    throw new Error("Page count must be a whole number, 0 or more.");
  }
  return Array.from({ length: pageCount }, (_, i) => i + 1);
}

/** Move one item; no-op when the indices are out of range or unchanged. */
export function moveIndex<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items.slice();
  }
  const next = items.slice();
  const [removed] = next.splice(from, 1);
  if (removed === undefined) return items.slice();
  next.splice(to, 0, removed);
  return next;
}

export function isIdentityOrder(order: readonly number[]): boolean {
  return order.every((page, i) => page === i + 1);
}

/**
 * A permutation of 1..pageCount. Used by single-file reorder so we never
 * drop or duplicate a page when rewriting with copyPages.
 */
export function assertPageOrder(order: readonly number[], pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error("This file has no pages to reorder.");
  }
  if (order.length !== pageCount) {
    throw new Error(`Page order must list all ${pageCount} pages once.`);
  }
  const seen = new Set<number>();
  for (const page of order) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is outside 1–${pageCount}.`);
    }
    if (seen.has(page)) {
      throw new Error(`Page ${page} is listed twice.`);
    }
    seen.add(page);
  }
  return [...order];
}

export type PageRef = {
  bytes: ArrayBuffer;
  page: number;
};

export type NamedPdf = {
  name: string;
  bytes: ArrayBuffer;
  pages: number;
};

export type PageSlot = {
  id: string;
  sourceName: string;
  sourceBytes: ArrayBuffer;
  /** 1-based page number in the source file. */
  sourcePage: number;
};

export function newPageSlotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `page-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function slotsFromPdf(file: NamedPdf): PageSlot[] {
  return Array.from({ length: file.pages }, (_, i) => ({
    id: newPageSlotId(),
    sourceName: file.name,
    sourceBytes: file.bytes,
    sourcePage: i + 1,
  }));
}

export function slotsFromPdfs(files: readonly NamedPdf[]): PageSlot[] {
  return files.flatMap((file) => slotsFromPdf(file));
}

export function slotsMatchFileOrder(
  slots: readonly PageSlot[],
  files: readonly NamedPdf[],
): boolean {
  const expected = files.flatMap((file) =>
    Array.from({ length: file.pages }, (_, i) => ({
      bytes: file.bytes,
      page: i + 1,
    })),
  );
  if (slots.length !== expected.length) return false;
  return slots.every(
    (slot, i) => slot.sourceBytes === expected[i]?.bytes && slot.sourcePage === expected[i]?.page,
  );
}

export function refsFromSlots(slots: readonly PageSlot[]): PageRef[] {
  return slots.map((slot) => ({ bytes: slot.sourceBytes, page: slot.sourcePage }));
}
