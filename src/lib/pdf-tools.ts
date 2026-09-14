/**
 * pdf-lib operations. All of these run in the browser on a copy of the bytes;
 * the original file on disk is never touched and nothing is uploaded.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { containFit } from "./image-process";
import { encodeDemoPhoto } from "./tiny-png";
import type { AnnotationBurn, ImagePatch } from "./pdf-images";
import { jpegMagic } from "./pdf-images";
import { fitFontSize } from "./text-helpers";

export type SplitOutput = { name: string; bytes: Uint8Array; pages: number };

async function load(bytes: ArrayBuffer) {
  return PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
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

export type TextPatch = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  text: string;
};

/**
 * Writes only the edited boxes. Every other object on the page is left exactly
 * as the original author wrote it — no full-page redraw.
 * Type shrinks (never past 4pt) so replacement copy stays inside the old box.
 */
export async function applyTextPatches(
  bytes: ArrayBuffer,
  patches: TextPatch[],
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const patch of patches) {
    const page = pages[patch.page - 1];
    if (!page) continue;
    const pad = Math.max(1, patch.fontSize * 0.18);

    // Cover the old glyphs only, then draw the replacement in the same slot.
    page.drawRectangle({
      x: patch.x - pad,
      y: patch.y - pad * 1.1,
      width: patch.width + pad * 4,
      height: patch.height + pad * 1.6,
      color: rgb(1, 1, 1),
    });

    let size = fitFontSize(patch.text, patch.fontSize, patch.width);
    while (size > 4 && font.widthOfTextAtSize(patch.text, size) > patch.width) size -= 0.25;

    // Single line, no wrapping: the replacement must stay inside the old slot.
    page.drawText(patch.text.replace(/\s*\n\s*/g, " "), {
      x: patch.x,
      y: patch.y + Math.max(0, (patch.height - size) * 0.28),
      size,
      font,
      color: rgb(0.08, 0.08, 0.1),
    });
  }

  return doc.save();
}

export async function applyWorkshopPatches(
  bytes: ArrayBuffer,
  textPatches: TextPatch[],
  imagePatches: ImagePatch[],
  marks: AnnotationBurn[],
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  const font = textPatches.length ? await doc.embedFont(StandardFonts.Helvetica) : null;

  for (const patch of imagePatches) {
    const page = pages[patch.page - 1];
    if (!page) continue;
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

  if (font) {
    for (const patch of textPatches) {
      const page = pages[patch.page - 1];
      if (!page) continue;
      const pad = Math.max(1, patch.fontSize * 0.18);
      page.drawRectangle({
        x: patch.x - pad,
        y: patch.y - pad * 1.1,
        width: patch.width + pad * 4,
        height: patch.height + pad * 1.6,
        color: rgb(1, 1, 1),
      });
      let size = fitFontSize(patch.text, patch.fontSize, patch.width);
      while (size > 4 && font.widthOfTextAtSize(patch.text, size) > patch.width) size -= 0.25;
      page.drawText(patch.text.replace(/\s*\n\s*/g, " "), {
        x: patch.x,
        y: patch.y + Math.max(0, (patch.height - size) * 0.28),
        size,
        font,
        color: rgb(0.08, 0.08, 0.1),
      });
    }
  }

  for (const mark of marks) {
    const page = pages[mark.page - 1];
    if (!page) continue;
    if (mark.kind === "redact") {
      page.drawRectangle({
        x: mark.x,
        y: mark.y,
        width: mark.width,
        height: mark.height,
        color: rgb(0.06, 0.06, 0.07),
      });
    } else {
      page.drawRectangle({
        x: mark.x,
        y: mark.y,
        width: mark.width,
        height: mark.height,
        borderColor: rgb(0.48, 0.27, 0.14),
        borderWidth: 1.35,
        color: rgb(1, 1, 1),
        opacity: 0,
        borderOpacity: 1,
      });
    }
  }

  return doc.save();
}

/** A quote with photos, rules, and a deliberately wrong total. */
export async function buildSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
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
