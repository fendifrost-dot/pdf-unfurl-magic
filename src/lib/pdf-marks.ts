/**
 * Overlay marks. Highlight / note become real PDF annotations via the pdf.js
 * editor save path (pdf-annotate-js.ts). Underline / rectangle are native
 * annot dicts. Visual redact still burns a black box into the page stream —
 * underlying operators stay extractable. Does not touch applyTextPatches.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { partitionMarks, saveEditorAnnotations, writeNativeAnnotations } from "./pdf-annotate-js";
import type { AnnotationBurn } from "./pdf-images";

export type { AnnotationBurn, AnnotationKind } from "./pdf-images";
export type PageMark = AnnotationBurn;
export { partitionMarks } from "./pdf-annotate-js";

export function exportFileName(base: string, hasEdits: boolean, marks: AnnotationBurn[]): string {
  if (marks.some((m) => m.kind === "redact")) return `${base}-redacted.pdf`;
  if (marks.length) return `${base}-marked.pdf`;
  if (hasEdits) return `${base}-edited.pdf`;
  return `${base}-copy.pdf`;
}

function wrapNote(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (!words[0]) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function burnMarkOnPage(page: PDFPage, mark: AnnotationBurn, font: PDFFont) {
  const { width: pw, height: ph } = page.getSize();
  const x = Math.max(0, Math.min(mark.x, pw));
  const y = Math.max(0, Math.min(mark.y, ph));
  const width = Math.max(1, Math.min(mark.width, pw - x));
  const height = Math.max(1, Math.min(mark.height, ph - y));

  if (mark.kind === "highlight") {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: rgb(1, 0.86, 0.2),
      opacity: 0.34,
      borderColor: rgb(0.82, 0.62, 0.08),
      borderWidth: 0.4,
      borderOpacity: 0.45,
    });
    return;
  }

  if (mark.kind === "underline") {
    page.drawLine({
      start: { x, y: y + 1.1 },
      end: { x: x + width, y: y + 1.1 },
      thickness: Math.min(2.2, Math.max(1.1, height * 0.12)),
      color: rgb(0.72, 0.16, 0.12),
    });
    return;
  }

  if (mark.kind === "note") {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: rgb(1, 0.93, 0.48),
      borderColor: rgb(0.72, 0.52, 0.1),
      borderWidth: 0.8,
    });
    const text = (mark.text ?? "").trim();
    if (!text) return;
    const size = 8;
    const pad = 5;
    const lines = wrapNote(text, font, size, Math.max(8, width - pad * 2));
    let ty = y + height - pad - size;
    for (const line of lines) {
      if (ty < y + pad) break;
      page.drawText(line, {
        x: x + pad,
        y: ty,
        size,
        font,
        color: rgb(0.18, 0.14, 0.08),
      });
      ty -= size * 1.25;
    }
    return;
  }

  if (mark.kind === "redact") {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: rgb(0.06, 0.06, 0.07),
      opacity: 1,
    });
    return;
  }

  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0.48, 0.27, 0.14),
    borderWidth: 1.35,
    color: rgb(1, 1, 1),
    opacity: 0,
    borderOpacity: 1,
  });
}

export async function burnMarksOnPages(pages: PDFPage[], marks: AnnotationBurn[], font: PDFFont) {
  const ordered = [...marks].sort(
    (a, b) => Number(a.kind === "redact") - Number(b.kind === "redact"),
  );
  for (const mark of ordered) {
    const page = pages[mark.page - 1];
    if (!page) continue;
    burnMarkOnPage(page, mark, font);
  }
}

export async function applyBurnAndNativeMarks(doc: PDFDocument, marks: AnnotationBurn[]) {
  const { burn, native } = partitionMarks(marks);
  if (burn.length) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    await burnMarksOnPages(doc.getPages(), burn, font);
  }
  if (native.length) writeNativeAnnotations(doc, native);
}

export async function applyPageMarks(
  bytes: ArrayBuffer | Uint8Array,
  marks: AnnotationBurn[],
): Promise<Uint8Array> {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await PDFDocument.load(src.slice(), { ignoreEncryption: true });
  await applyBurnAndNativeMarks(doc, marks);
  let out = await doc.save();
  const { editor } = partitionMarks(marks);
  if (editor.length) {
    out = (await saveEditorAnnotations(out, editor)).bytes;
  }
  return out;
}
