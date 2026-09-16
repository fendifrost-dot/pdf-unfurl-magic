/**
 * pdf-lib operations. All of these run in the browser on a copy of the bytes;
 * the original file on disk is never touched and nothing is uploaded.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { containFit } from "./image-process";
import { encodeDemoPhoto } from "./tiny-png";
import { bytesToArrayBuffer, loadPdfDocument } from "./pdf-io";
import type { AnnotationBurn, ImagePatch } from "./pdf-images";
import { jpegMagic } from "./pdf-images";
import { replaceImageXObject } from "./pdf-image-xobject";
import { applyBurnAndNativeMarks } from "./pdf-marks";
import { saveEditorAnnotations } from "./pdf-annotate-js";
import { editorMarksForSave } from "./pdf-redact";
import { applyTextPatches, type TextPatch } from "./pdf-text-edit";
import { applyScanPagePatches, type ScanPageExport } from "./pdf-scan-edit";
import { applyAcroFormToDocument, type AcroFormFillRequest } from "./pdf-acroform";
import { applyPageRotationsToDocument, type PageRotation } from "./pdf-rotate";
export type { AcroFormFillRequest } from "./pdf-acroform";
export type { PageRotation, PageRotateDeg } from "./pdf-rotate";
export {
  applyPageRotations,
  applyPageRotationsToDocument,
  inspectPageLayout,
  listPageRotations,
  rotatePagesBy,
} from "./pdf-rotate";
export type {
  TextPatch,
  TextEditReport,
  TextEditInspection,
  TextLayerInspection,
} from "./pdf-text-edit";
export {
  applyTextPatches,
  applyTextPatchesWithReport,
  inspectTextPatch,
  inspectTextLayer,
  listPageTextShows,
  listPageEmbeddedFonts,
} from "./pdf-text-edit";
export {
  inspectPageScan,
  inspectPageScanPaint,
  applyScanPagePatches,
  type ScanPageExport,
  type ScanPaintReport,
} from "./pdf-scan-edit";

export type SplitOutput = { name: string; bytes: Uint8Array; pages: number };

async function load(bytes: ArrayBuffer) {
  return loadPdfDocument(bytes);
}

/** Split into fixed-size chunks so a huge file becomes several openable ones. */
export async function splitIntoChunks(
  bytes: ArrayBuffer,
  baseName: string,
  chunkSize: number,
): Promise<SplitOutput[]> {
  const src = await load(bytes);
  const total = src.getPageCount();
  const out: SplitOutput[] = [];
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

/** Pull specific pages (1-based) into one new file. */
export async function extractPages(
  bytes: ArrayBuffer,
  baseName: string,
  pages: number[],
): Promise<SplitOutput> {
  const src = await load(bytes);
  const doc = await PDFDocument.create();
  const copied = await doc.copyPages(
    src,
    pages.map((p) => p - 1),
  );
  copied.forEach((p) => doc.addPage(p));
  return { name: `${baseName}-extract.pdf`, bytes: await doc.save(), pages: pages.length };
}

/** Merge several files, in the given order, into one. */
export async function mergeFiles(
  inputs: Array<{ name: string; bytes: ArrayBuffer }>,
): Promise<SplitOutput> {
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

export async function getPageCount(bytes: ArrayBuffer): Promise<number> {
  const doc = await load(bytes);
  return doc.getPageCount();
}

/**
 * Apply in-place text rewrites first, then rebuild any scan-aware pages
 * (image + OCR text layer), then replace photo XObjects in place (no whiteout),
 * permanently erase `erase` marks, burn cover boxes, and write highlight/note
 * as real PDF annotations.
 * Overlay white-rect + stacked drawImage is only used when no identifiable
 * image XObject exists on the page. Optional AcroForm fill + flatten burns
 * field appearances into the page and drops widget annotations.
 * Optional page rotations write /Rotate last so text, forms, and marks stay
 * in user space (Acrobat-style). The source bytes are never overwritten.
 */
export async function applyWorkshopPatches(
  bytes: ArrayBuffer,
  textPatches: TextPatch[],
  imagePatches: ImagePatch[],
  marks: AnnotationBurn[],
  scanPatches: ScanPageExport[] = [],
  formFill?: AcroFormFillRequest | null,
  pageRotations: PageRotation[] = [],
): Promise<Uint8Array> {
  const afterText = textPatches.length ? await applyTextPatches(bytes, textPatches) : null;
  const afterScan = scanPatches.length
    ? await applyScanPagePatches(afterText ? bytesToArrayBuffer(afterText) : bytes, scanPatches)
    : afterText;
  const doc = await load(afterScan ? bytesToArrayBuffer(afterScan) : bytes);
  const pages = doc.getPages();

  for (const patch of imagePatches) {
    const page = pages[patch.page - 1];
    if (!page) continue;
    if (await replaceImageXObject(doc, page, patch)) continue;

    const mime = patch.mime ?? jpegMagic(patch.bytes);
    const image =
      mime === "image/png" ? await doc.embedPng(patch.bytes) : await doc.embedJpg(patch.bytes);
    page.drawRectangle({
      x: patch.x,
      y: patch.y,
      width: patch.width,
      height: patch.height,
      color: rgb(1, 1, 1),
    });
    const fitted = containFit(image.width, image.height, patch.width, patch.height);
    page.drawImage(image, {
      x: patch.x + fitted.x,
      y: patch.y + fitted.y,
      width: fitted.w,
      height: fitted.h,
    });
  }

  if (formFill) {
    applyAcroFormToDocument(doc, formFill);
  }

  if (marks.length) {
    await applyBurnAndNativeMarks(doc, marks);
  }

  if (pageRotations.length) {
    applyPageRotationsToDocument(doc, pageRotations);
  }

  let out = await doc.save();
  const editor = editorMarksForSave(marks);
  if (editor.length) {
    out = (await saveEditorAnnotations(out, editor)).bytes;
  }
  return out;
}

/** A quote with photos, rules, multi-font terms, and a deliberately wrong total. */
export async function buildSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(0.1, 0.11, 0.13);
  const soft = rgb(0.42, 0.44, 0.48);
  const oak = await doc.embedPng(encodeDemoPhoto("oak", 320, 200));
  const kitchen = await doc.embedPng(encodeDemoPhoto("kitchen", 280, 180));
  const washout = await doc.embedPng(encodeDemoPhoto("washout", 360, 220));

  let y = 770;
  const write = (
    text: string,
    opts: { size?: number; font?: typeof body; x?: number; color?: typeof ink } = {},
  ) => {
    page.drawText(text, {
      x: opts.x ?? 56,
      y,
      size: opts.size ?? 11,
      font: opts.font ?? body,
      color: opts.color ?? ink,
    });
  };

  write("Northgate Joinery", { size: 20, font: bold });
  y -= 18;
  write("Quote 2026-118 — kitchen bench rebuild", { size: 10, color: soft });
  y -= 34;
  write("Prepared for: R. Alvarez, 14 Wren Street", { size: 10 });
  y -= 14;
  write("Valid for 30 days. Please kindly note that timber prices really move weekly.", {
    size: 10,
    color: soft,
  });

  page.drawImage(oak, { x: 390, y: 708, width: 150, height: 94 });
  page.drawText("Site photo — oak delivery", {
    x: 390,
    y: 694,
    size: 8,
    font: body,
    color: soft,
  });

  y -= 32;
  write("Description", { font: bold, size: 10 });
  write("Qty", { font: bold, size: 10, x: 360 });
  write("Rate", { font: bold, size: 10, x: 420 });
  write("Amount", { font: bold, size: 10, x: 490 });
  y -= 8;
  page.drawLine({
    start: { x: 56, y },
    end: { x: 539, y },
    thickness: 0.75,
    color: rgb(0.8, 0.8, 0.82),
  });

  const rows: Array<[string, string, string, string]> = [
    ["European oak worktop, 40mm", "3", "12", "35"],
    ["Cabinet carcasses, birch ply", "6", "148.00", "888.00"],
    ["Soft-close hinges and runners", "12", "21.50", "258.00"],
    ["Bench install labour, two days", "16", "62.00", "992.00"],
    ["Finish oil, three coats", "1", "84.00", "84.00"],
  ];

  y -= 18;
  for (const [desc, qty, rate, amount] of rows) {
    write(desc, { size: 10 });
    write(qty, { size: 10, x: 360 });
    write(rate, { size: 10, x: 420 });
    write(amount, { size: 10, x: 490 });
    y -= 18;
  }

  y -= 6;
  page.drawLine({
    start: { x: 340, y },
    end: { x: 539, y },
    thickness: 0.75,
    color: rgb(0.8, 0.8, 0.82),
  });
  y -= 20;
  // Deliberately wrong: the line items add up to 2257.00, not 1987.00.
  write("Total due", { font: bold, size: 11, x: 420 });
  write("1,987.00", { font: bold, size: 11, x: 490 });

  page.drawImage(kitchen, { x: 56, y: 318, width: 220, height: 141 });
  page.drawLine({
    start: { x: 56, y: 308 },
    end: { x: 276, y: 308 },
    thickness: 0.75,
    color: rgb(0.8, 0.8, 0.82),
  });
  page.drawText("Finished bench — client reference. Fix the photo, not the page.", {
    x: 56,
    y: 294,
    size: 8,
    font: body,
    color: soft,
  });

  y = 250;
  write("3 x 12 = 35 for the worktop run (per-metre pricing).", { size: 10, color: soft });
  y -= 16;
  write("Deposit of 40% is due before before the timber order is placed.", {
    size: 10,
    color: soft,
  });
  y -= 28;
  write("Terms follow the Joinery Supply Agreement, clause 4.", {
    size: 10,
    font: serif,
    color: soft,
  });
  y -= 16;
  write("SKU  NG-BENCH-40-OAK", { size: 10, font: mono });

  // Page 2 must stay untouched so in-place text tests can prove an edit on
  // page 1 does not flatten or rewrite the next page.
  const page2 = doc.addPage([595, 842]);
  page2.drawText("UNTOUCHED PAGE", { x: 56, y: 770, size: 16, font: bold, color: ink });
  page2.drawText("Reference code REF-4421. Do not amend this page.", {
    x: 56,
    y: 742,
    size: 10,
    font: body,
    color: soft,
  });
  page2.drawLine({
    start: { x: 56, y: 720 },
    end: { x: 539, y: 720 },
    thickness: 1,
    color: rgb(0.75, 0.76, 0.78),
  });
  page2.drawText("Vector rule and original text objects must survive an edit on page 1.", {
    x: 56,
    y: 698,
    size: 10,
    font: serif,
    color: ink,
  });

  const appendix = doc.addPage([595, 842]);
  appendix.drawText("Photo appendix", { x: 56, y: 780, size: 20, font: bold, color: ink });
  appendix.drawText("Washed-out site shot — pull exposure down, then compress.", {
    x: 56,
    y: 758,
    size: 11,
    font: body,
    color: soft,
  });
  appendix.drawImage(washout, { x: 56, y: 430, width: 360, height: 220 });
  appendix.drawLine({
    start: { x: 56, y: 414 },
    end: { x: 416, y: 414 },
    thickness: 0.9,
    color: rgb(0.8, 0.8, 0.82),
  });
  appendix.drawText("NORTHGATE_KEEP  ·  surrounding type and this rule stay as PDF objects.", {
    x: 56,
    y: 396,
    size: 10,
    font: body,
    color: ink,
  });

  return doc.save();
}
