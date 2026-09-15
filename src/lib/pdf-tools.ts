/**
 * pdf-lib operations. All of these run in the browser on a copy of the bytes;
 * the original file on disk is never touched and nothing is uploaded.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { loadPdfDocument } from "./pdf-io";
export type { TextPatch, TextEditReport, TextEditInspection } from "./pdf-text-edit";
export { applyTextPatches, applyTextPatchesWithReport, inspectTextPatch } from "./pdf-text-edit";

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
 * Multi-font quote: Helvetica / Helvetica-Bold amounts, Times terms, Courier SKU,
 * plus a second page that must stay byte-stable when page 1 is edited.
 */
export async function buildSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(0.1, 0.11, 0.13);
  const soft = rgb(0.42, 0.44, 0.48);

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

  y -= 40;
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

  return doc.save();
}
