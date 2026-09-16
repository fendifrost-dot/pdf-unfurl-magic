/**
 * Shared pdf-lib operations used by the smoke harness.
 * Mirrors src/lib/pdf-tools.ts (load / split / extract / merge / save) so
 * feature PRs can assert page counts and export size without importing TS.
 */
import { PDFDocument, PDFArray, PDFName, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream, rgb } from "pdf-lib";

function asBytes(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

async function load(bytes) {
  return PDFDocument.load(asBytes(bytes).slice(0), { ignoreEncryption: true });
}

export async function getPageCount(bytes) {
  const doc = await load(bytes);
  return doc.getPageCount();
}

export async function splitIntoChunks(bytes, baseName, chunkSize) {
  const src = await load(bytes);
  const total = src.getPageCount();
  const out = [];
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total);
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(
      src,
      Array.from({ length: end - start }, (_, i) => start + i),
    );
    copied.forEach((p) => doc.addPage(p));
    out.push({
      name: `${baseName}-pages-${start + 1}-${end}.pdf`,
      bytes: await doc.save(),
      pages: end - start,
    });
  }
  return out;
}

export async function extractPages(bytes, baseName, pages) {
  const src = await load(bytes);
  const doc = await PDFDocument.create();
  const copied = await doc.copyPages(
    src,
    pages.map((p) => p - 1),
  );
  copied.forEach((p) => doc.addPage(p));
  return { name: `${baseName}-extract.pdf`, bytes: await doc.save(), pages: pages.length };
}

export async function mergeFiles(inputs) {
  const doc = await PDFDocument.create();
  let pages = 0;
  for (const input of inputs) {
    const src = await load(input.bytes);
    const copied = await doc.copyPages(src, src.getPageIndices());
    copied.forEach((p) => doc.addPage(p));
    pages += copied.length;
  }
  return { name: "merged.pdf", bytes: await doc.save(), pages };
}

export function assertPageOrder(order, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error("This file has no pages to reorder.");
  }
  if (order.length !== pageCount) {
    throw new Error(`Page order must list all ${pageCount} pages once.`);
  }
  const seen = new Set();
  for (const page of order) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is outside 1–${pageCount}.`);
    }
    if (seen.has(page)) throw new Error(`Page ${page} is listed twice.`);
    seen.add(page);
  }
  return [...order];
}

export async function copyPagesInOrder(pages, name = "merged.pdf") {
  if (!pages.length) throw new Error("Add at least one page.");
  const doc = await PDFDocument.create();
  const cache = new Map();
  for (const slot of pages) {
    let src = cache.get(slot.bytes);
    if (!src) {
      src = await load(slot.bytes);
      cache.set(slot.bytes, src);
    }
    const index = slot.page - 1;
    const total = src.getPageCount();
    if (!Number.isInteger(slot.page) || index < 0 || index >= total) {
      throw new Error(`Page ${slot.page} is outside 1–${total}.`);
    }
    const [copied] = await doc.copyPages(src, [index]);
    doc.addPage(copied);
  }
  return { name, bytes: await doc.save(), pages: pages.length };
}

/** Rewrite one file with pages in a new 1-based order. Source bytes are only read. */
export async function reorderPages(bytes, order, baseName = "document") {
  const src = await load(bytes);
  const normalized = assertPageOrder(order, src.getPageCount());
  return copyPagesInOrder(
    normalized.map((page) => ({ bytes, page })),
    `${baseName}-reordered.pdf`,
  );
}

function streamLatin1(doc, refOrStream) {
  const obj = refOrStream instanceof PDFRef ? doc.context.lookup(refOrStream) : refOrStream;
  if (obj instanceof PDFRawStream) {
    return Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
  }
  if (obj instanceof PDFArray) {
    return obj.asArray().map((item) => streamLatin1(doc, item)).join("");
  }
  return "";
}

/** Decoded page content (not the flate raw bytes) so markers are searchable. */
export async function pageContentLatin1(bytes, pageNumber) {
  const doc = await load(bytes);
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return "";
  const raw = streamLatin1(doc, page.node.get(PDFName.of("Contents")));
  // pdf-lib copyPages often rewrites Tj strings as hex: <504147...> 
  return raw.replace(/<([0-9A-Fa-f]+)>/g, (_, hex) => Buffer.from(hex, "hex").toString("latin1"));
}

/** Minimal stand-in for applyTextPatches: cover one box and write replacement text. */
export async function applyTextPatch(bytes, text = "patched by smoke") {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.getPages()[0];
  if (!page) throw new Error("PDF has no pages");
  page.drawRectangle({ x: 50, y: 700, width: 280, height: 18, color: rgb(1, 1, 1) });
  page.drawText(text, { x: 56, y: 704, size: 12, font, color: rgb(0.08, 0.08, 0.1) });
  return doc.save();
}

export function assertExportSizeSane(
  label,
  exportedBytes,
  sourceBytes,
  { minRatio = 0.15, maxRatio = 4 } = {},
) {
  const out = exportedBytes.byteLength;
  const src = sourceBytes.byteLength;
  if (out < 200) throw new Error(`${label}: export is empty (${out} bytes)`);
  if (out > Math.max(20_000, Math.ceil(src * maxRatio))) {
    throw new Error(`${label}: export exploded (${out} bytes vs source ${src})`);
  }
  if (out < Math.floor(src * minRatio)) {
    throw new Error(`${label}: export shrank too far (${out} bytes vs source ${src})`);
  }
}
