/**
 * Smoke-check: marks append drawing ops; redaction burns a black box;
 * in-place text patches can still run first via applyWorkshopPatches.
 */
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { applyPageMarks, exportFileName } from "../src/lib/pdf-marks.ts";
import { applyWorkshopPatches, buildSamplePdf } from "../src/lib/pdf-tools.ts";

const sample = await buildSamplePdf();
const marked = await applyPageMarks(sample, [
  { id: "h1", page: 1, kind: "highlight", x: 56, y: 700, width: 200, height: 16 },
  { id: "u1", page: 1, kind: "underline", x: 56, y: 640, width: 180, height: 14 },
  {
    id: "n1",
    page: 1,
    kind: "note",
    x: 360,
    y: 600,
    width: 140,
    height: 60,
    text: "Check the total",
  },
  { id: "r1", page: 1, kind: "redact", x: 490, y: 520, width: 56, height: 16 },
]);

const both = await applyWorkshopPatches(
  sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength),
  [],
  [],
  [{ id: "r2", page: 1, kind: "redact", x: 490, y: 520, width: 56, height: 16 }],
);

const srcDoc = await PDFDocument.load(sample);
const outDoc = await PDFDocument.load(marked);
const bothDoc = await PDFDocument.load(both);
if (
  srcDoc.getPageCount() !== outDoc.getPageCount() ||
  srcDoc.getPageCount() !== bothDoc.getPageCount()
) {
  throw new Error("page count changed");
}

const srcPage = srcDoc.getPages()[0];
const outPage = outDoc.getPages()[0];
if (srcPage.getWidth() !== outPage.getWidth() || srcPage.getHeight() !== outPage.getHeight()) {
  throw new Error("page size changed");
}

const name = exportFileName("quote", true, [
  { id: "r1", page: 1, kind: "redact", x: 0, y: 0, width: 10, height: 10 },
]);
if (name !== "quote-redacted.pdf") throw new Error(`unexpected name ${name}`);

if (marked.byteLength <= sample.byteLength) {
  throw new Error("export copy did not grow after appending marks");
}

const probe = await PDFDocument.create();
const page = probe.addPage([200, 200]);
const font = await probe.embedFont(StandardFonts.Helvetica);
page.drawText("SECRET", { x: 20, y: 100, size: 18, font, color: rgb(0, 0, 0) });
const probeBytes = await probe.save();
const burned = await applyPageMarks(probeBytes, [
  { id: "r", page: 1, kind: "redact", x: 16, y: 90, width: 90, height: 24 },
]);
if (burned.byteLength <= probeBytes.byteLength) {
  throw new Error("redaction did not append a burned box");
}

console.log("smoke-annotate ok", {
  sample: sample.byteLength,
  marked: marked.byteLength,
  both: both.byteLength,
});
