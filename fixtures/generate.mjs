/**
 * Regenerates the committed synthetic PDFs in this folder.
 * Run: npm run fixtures:generate
 *
 * These files are tiny on purpose so other feature PRs can drop them
 * into the bench / editor / scan / e-sign without shipping real documents.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const ROOT = dirname(fileURLToPath(import.meta.url));

/** 1×1 sRGB PNG (blue). Drawn large on the page so the fixture stays tiny. */
const BLUE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==",
  "base64",
);

const A4 = [595.28, 841.89];
const ink = rgb(0.1, 0.11, 0.13);
const soft = rgb(0.42, 0.44, 0.48);
const rule = rgb(0.72, 0.73, 0.76);

async function stamp(doc, title) {
  doc.setTitle(title);
  doc.setProducer("PDF Relief fixtures");
  doc.setCreator("PDF Relief fixtures");
  doc.setSubject("Synthetic QA fixture — not a real document");
}

async function simpleText() {
  const doc = await PDFDocument.create();
  await stamp(doc, "simple-text");
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("PDF Relief fixture: simple text", { x: 56, y: 780, size: 18, font, color: ink });
  page.drawText("One page. Helvetica only. Known line for click-to-edit smoke.", {
    x: 56,
    y: 750,
    size: 11,
    font,
    color: soft,
  });
  page.drawText("REPLACE_ME: workshop docket 118", { x: 56, y: 710, size: 12, font, color: ink });
  return doc.save();
}

async function multiFont() {
  const doc = await PDFDocument.create();
  await stamp(doc, "multi-font");
  const page = doc.addPage(A4);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const courier = await doc.embedFont(StandardFonts.Courier);

  page.drawText("PDF Relief fixture: multi-font", {
    x: 56,
    y: 780,
    size: 18,
    font: bold,
    color: ink,
  });
  page.drawText("Helvetica body — default workshop copy.", {
    x: 56,
    y: 740,
    size: 12,
    font: helvetica,
    color: ink,
  });
  page.drawText("Times-Roman — a serif amount line: 1,987.00", {
    x: 56,
    y: 716,
    size: 12,
    font: times,
    color: ink,
  });
  page.drawText("Courier SKU  NG-BENCH-40MM", {
    x: 56,
    y: 692,
    size: 12,
    font: courier,
    color: ink,
  });
  page.drawText("Helvetica-Bold label", { x: 56, y: 668, size: 12, font: bold, color: ink });
  return doc.save();
}

async function linesAndText() {
  const doc = await PDFDocument.create();
  await stamp(doc, "lines-and-text");
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawText("PDF Relief fixture: lines + text", {
    x: 56,
    y: 780,
    size: 18,
    font: bold,
    color: ink,
  });
  page.drawText("Form-style rules. Neighbouring lines must survive a one-box edit.", {
    x: 56,
    y: 754,
    size: 10,
    font,
    color: soft,
  });

  const rows = [
    ["Item", "Qty", "Amount"],
    ["Oak worktop", "3", "36.00"],
    ["Hinges", "12", "258.00"],
  ];
  let y = 710;
  for (const [a, b, c] of rows) {
    page.drawText(a, { x: 56, y, size: 11, font: y === 710 ? bold : font, color: ink });
    page.drawText(b, { x: 320, y, size: 11, font: y === 710 ? bold : font, color: ink });
    page.drawText(c, { x: 420, y, size: 11, font: y === 710 ? bold : font, color: ink });
    y -= 8;
    page.drawLine({ start: { x: 56, y }, end: { x: 539, y }, thickness: 0.75, color: rule });
    y -= 20;
  }
  page.drawText("Signature", { x: 56, y: 560, size: 11, font, color: soft });
  page.drawLine({ start: { x: 120, y: 560 }, end: { x: 320, y: 560 }, thickness: 1, color: ink });
  return doc.save();
}

async function imageAndText() {
  const doc = await PDFDocument.create();
  await stamp(doc, "image-and-text");
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const image = await doc.embedPng(BLUE_PIXEL_PNG);

  page.drawText("PDF Relief fixture: image + text", {
    x: 56,
    y: 780,
    size: 18,
    font: bold,
    color: ink,
  });
  page.drawImage(image, { x: 56, y: 640, width: 160, height: 96 });
  page.drawText("Caption: blue placeholder PNG. The photo must not flatten when text is edited.", {
    x: 56,
    y: 616,
    size: 10,
    font,
    color: soft,
  });
  page.drawText("REPLACE_ME: photo note", { x: 56, y: 592, size: 12, font, color: ink });
  return doc.save();
}

async function multiPage() {
  const doc = await PDFDocument.create();
  await stamp(doc, "multi-page");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodies = [
    "Page 1 of 3 — cover. Use this page for a first-pass edit.",
    "Page 2 of 3 — middle. Must stay intact if only page 1 is rewritten.",
    "Page 3 of 3 — last. Split / extract / merge smoke target.",
  ];
  for (let i = 0; i < bodies.length; i++) {
    const page = doc.addPage(A4);
    page.drawText(`PDF Relief fixture: multi-page (${i + 1}/3)`, {
      x: 56,
      y: 780,
      size: 18,
      font: bold,
      color: ink,
    });
    page.drawText(bodies[i], { x: 56, y: 744, size: 12, font, color: ink });
    page.drawText(`PAGE_MARKER_${i + 1}`, { x: 56, y: 710, size: 11, font, color: soft });
  }
  return doc.save();
}

const BUILDERS = [
  {
    file: "simple-text.pdf",
    pages: 1,
    kind: "simple-text",
    summary: "One Helvetica page with a REPLACE_ME line.",
    build: simpleText,
    maxBytes: 8_000,
  },
  {
    file: "multi-font.pdf",
    pages: 1,
    kind: "multi-font",
    summary: "Helvetica, Helvetica-Bold, Times-Roman, Courier on one page.",
    build: multiFont,
    maxBytes: 12_000,
  },
  {
    file: "lines-and-text.pdf",
    pages: 1,
    kind: "lines-text",
    summary: "Table rules plus a signature line. Neighbouring vectors must survive edits.",
    build: linesAndText,
    maxBytes: 12_000,
  },
  {
    file: "image-and-text.pdf",
    pages: 1,
    kind: "image-text",
    summary: "Embedded PNG plus a caption. Image must remain a PDF image object.",
    build: imageAndText,
    maxBytes: 20_000,
  },
  {
    file: "multi-page.pdf",
    pages: 3,
    kind: "multi-page",
    summary: "Three labeled pages for split / extract / merge and untouched-page checks.",
    build: multiPage,
    maxBytes: 16_000,
  },
];

mkdirSync(ROOT, { recursive: true });

const manifest = { generatedBy: "fixtures/generate.mjs", files: [] };

for (const item of BUILDERS) {
  const bytes = await item.build();
  writeFileSync(join(ROOT, item.file), bytes);
  manifest.files.push({
    file: item.file,
    pages: item.pages,
    kind: item.kind,
    summary: item.summary,
    bytes: bytes.byteLength,
    maxBytes: item.maxBytes,
  });
  console.log(`wrote ${item.file} (${bytes.byteLength} bytes, ${item.pages} page(s))`);
}

writeFileSync(join(ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("wrote manifest.json");
