import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { applyPageMarks, exportFileName } from "./pdf-marks";
import { applyWorkshopPatches } from "./pdf-tools";
import {
  listPageAnnotationSubtypes,
  partitionMarks,
  writeNativeAnnotations,
} from "./pdf-annotate-js";
import { decodePageContentRaw, listPageShownText } from "./pdf-text-edit";
import {
  PERMANENT_REDACT_GAPS,
  applyPermanentRedaction,
  editorMarksForSave,
  glyphBoxesForShow,
  keptTextForShow,
  rectsOverlap,
} from "./pdf-redact";
import { decodeImageXObjectRgba, listPageImageDraws } from "./pdf-image-xobject";
import { encodePng } from "./tiny-png";
import { collectTextShows, tokenizeContentStream } from "./pdf-content-stream";

function fixture(name: string): Uint8Array {
  const buf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../fixtures", name));
  return new Uint8Array(buf);
}

GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MAGENTA = [255, 0, 255] as const;
const CYAN = [0, 255, 255] as const;

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function pdfJsText(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const proxy = await getDocument({ data: bytes.slice() }).promise;
  try {
    const page = await proxy.getPage(pageNumber);
    const content = await page.getTextContent();
    return content.items.map((item) => ("str" in item ? String(item.str) : "")).join(" ");
  } finally {
    await proxy.destroy();
  }
}

function pdftotextIfAvailable(bytes: Uint8Array): string | null {
  let installed = false;
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "pipe" });
    installed = true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 0 || status === 99) installed = true;
  }
  if (!installed) return null;
  try {
    const dir = mkdtempSync(join(tmpdir(), "pdf-relief-redact-"));
    const pdfPath = join(dir, "in.pdf");
    writeFileSync(pdfPath, bytes);
    return execFileSync("pdftotext", ["-raw", pdfPath, "-"], { encoding: "utf8" });
  } catch {
    return null;
  }
}

function magentaCyanPng(width = 16, height = 8): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const ink = x < width / 2 ? MAGENTA : CYAN;
      rgba[i] = ink[0];
      rgba[i + 1] = ink[1];
      rgba[i + 2] = ink[2];
      rgba[i + 3] = 255;
    }
  }
  return encodePng(width, height, rgba);
}

async function buildSecretPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("KEEP", { x: 40, y: 420, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText("SECRET", { x: 40, y: 360, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText("VISIBLE", { x: 40, y: 300, size: 18, font, color: rgb(0, 0, 0) });
  const image = await doc.embedPng(magentaCyanPng());
  page.drawImage(image, { x: 40, y: 80, width: 160, height: 80 });
  const bytes = await doc.save();
  const secretW = font.widthOfTextAtSize("SECRET", 18);
  return {
    bytes,
    font,
    secretBox: { x: 38, y: 350, width: secretW + 6, height: 28 },
    imageLeft: { x: 40, y: 80, width: 80, height: 80 },
  };
}

function assemblePdf(objects: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let length = parts[0]!.length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(length);
    const chunk = encoder.encode(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
    parts.push(chunk);
    length += chunk.length;
  }
  const xrefStart = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const tail = encoder.encode(
    `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );
  parts.push(tail);
  const out = new Uint8Array(parts.reduce((n, p) => p.length + n, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("permanent redaction helpers", () => {
  it("lists remaining gaps so the UI cannot claim full Acrobat coverage", () => {
    expect(PERMANENT_REDACT_GAPS.length).toBeGreaterThan(3);
    expect(PERMANENT_REDACT_GAPS.join(" ")).toMatch(/Form XObject/i);
    expect(PERMANENT_REDACT_GAPS.join(" ")).toMatch(/DCTDecode|JPEG/);
  });

  it("does not treat cover-box marks as editor annotations", () => {
    const { burn, erase, editor } = partitionMarks([
      { id: "c", page: 1, kind: "redact", x: 0, y: 0, width: 10, height: 10 },
      { id: "e", page: 1, kind: "erase", x: 0, y: 0, width: 10, height: 10 },
      { id: "h", page: 1, kind: "highlight", x: 0, y: 0, width: 10, height: 10 },
    ]);
    expect(burn.map((m) => m.kind)).toEqual(["redact"]);
    expect(erase.map((m) => m.kind)).toEqual(["erase"]);
    expect(editor.map((m) => m.kind)).toEqual(["highlight"]);
  });

  it("drops overlapping highlights from the editor save lane", () => {
    const saved = editorMarksForSave([
      { id: "e", page: 1, kind: "erase", x: 10, y: 10, width: 40, height: 20 },
      { id: "h", page: 1, kind: "highlight", x: 12, y: 12, width: 10, height: 10 },
      { id: "ok", page: 1, kind: "highlight", x: 200, y: 200, width: 10, height: 10 },
    ]);
    expect(saved.map((m) => m.id)).toEqual(["ok"]);
  });

  it("builds glyph boxes that overlap a SECRET run", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const tokens = tokenizeContentStream("BT /F1 18 Tf 1 0 0 1 40 360 Tm (SECRET) Tj ET");
    const show = collectTextShows(tokens)[0];
    expect(show?.text).toBe("SECRET");
    const boxes = glyphBoxesForShow(show!, (text, size) => font.widthOfTextAtSize(text, size));
    expect(boxes.map((b) => b.ch).join("")).toBe("SECRET");
    const hole = { x: 38, y: 350, width: 90, height: 28 };
    expect(boxes.some((b) => rectsOverlap(b, hole))).toBe(true);
    const kept = keptTextForShow(show!, [hole], (text, size) => font.widthOfTextAtSize(text, size));
    expect(kept.hit).toBe(true);
    expect(kept.kept).not.toMatch(/SECRET/);
  });
});

describe("cover box vs permanent redact", () => {
  it("keeps extractable SECRET under a cover box", async () => {
    const probe = await PDFDocument.create();
    const page = probe.addPage([200, 200]);
    const font = await probe.embedFont(StandardFonts.Helvetica);
    page.drawText("SECRET", { x: 20, y: 100, size: 18, font, color: rgb(0, 0, 0) });
    const bytes = await probe.save();
    const burned = await applyPageMarks(bytes, [
      { id: "r", page: 1, kind: "redact", x: 16, y: 90, width: 90, height: 24 },
    ]);
    const shown = await listPageShownText(asBuffer(burned), 1);
    expect(shown.join(" ")).toContain("SECRET");
    expect(await pdfJsText(burned)).toContain("SECRET");
    expect(
      exportFileName("memo", false, [
        { id: "r", page: 1, kind: "redact", x: 0, y: 0, width: 1, height: 1 },
      ]),
    ).toBe("memo-marked.pdf");
  });

  it("removes SECRET from operators and PDF.js text after permanent redact", async () => {
    const { bytes, secretBox } = await buildSecretPdf();
    const before = await listPageShownText(asBuffer(bytes), 1);
    expect(before.join(" ")).toMatch(/SECRET/);
    expect(before.join(" ")).toMatch(/KEEP/);

    const erased = await applyPageMarks(bytes, [{ id: "e", page: 1, kind: "erase", ...secretBox }]);
    const shown = await listPageShownText(asBuffer(erased), 1);
    const blob = shown.join(" ");
    expect(blob).not.toMatch(/SECRET/);
    expect(blob).toMatch(/KEEP/);
    expect(blob).toMatch(/VISIBLE/);

    const raw = await decodePageContentRaw(asBuffer(erased), 1);
    expect(raw).not.toContain("SECRET");
    expect(raw).not.toMatch(/534543524554/);
    expect(raw).toMatch(/KEEP|4B454550/);

    const js = await pdfJsText(erased);
    expect(js).not.toMatch(/SECRET/);
    expect(js).toMatch(/KEEP/);
    expect(js).toMatch(/VISIBLE/);

    const poppler = pdftotextIfAvailable(erased);
    if (poppler !== null) {
      expect(poppler).not.toMatch(/SECRET/);
      expect(poppler).toMatch(/KEEP/);
    }

    expect(
      exportFileName("memo", false, [
        { id: "e", page: 1, kind: "erase", x: 0, y: 0, width: 1, height: 1 },
      ]),
    ).toBe("memo-redacted.pdf");
  });

  it("rewrites a mixed Tj so only the intersecting glyphs disappear", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const size = 14;
    page.drawText("TOKEN SECRET END", { x: 20, y: 100, size, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();
    const prefix = font.widthOfTextAtSize("TOKEN ", size);
    const secretW = font.widthOfTextAtSize("SECRET", size);
    const erased = await applyPageMarks(bytes, [
      {
        id: "e",
        page: 1,
        kind: "erase",
        x: 20 + prefix - 1,
        y: 96,
        width: secretW + 2,
        height: 18,
      },
    ]);
    const blob = (await listPageShownText(asBuffer(erased), 1)).join(" ");
    expect(blob).not.toMatch(/SECRET/);
    expect(blob).toMatch(/TOKEN/);
    expect(blob).toMatch(/END/);
    expect(await pdfJsText(erased)).not.toMatch(/SECRET/);
  });

  it("drops a TJ operator whose glyphs intersect the rect", async () => {
    const stream = "BT\n/F1 12 Tf\n1 0 0 1 20 100 Tm\n[(SE) -20 (CRET)] TJ\nET\n";
    const streamObj = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    const probe = assemblePdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      streamObj,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]);
    expect((await listPageShownText(asBuffer(probe), 1)).join("")).toMatch(/SECRET/);
    const erased = await applyPageMarks(probe, [
      { id: "e", page: 1, kind: "erase", x: 18, y: 90, width: 80, height: 24 },
    ]);
    expect((await listPageShownText(asBuffer(erased), 1)).join(" ")).not.toMatch(/SECRET/);
    expect(await decodePageContentRaw(asBuffer(erased), 1)).not.toContain("CRET");
  });

  it("punches magenta pixels out of a simple image XObject", async () => {
    const { bytes, imageLeft } = await buildSecretPdf();
    const beforeDoc = await PDFDocument.load(bytes.slice());
    const beforeDraw = listPageImageDraws(beforeDoc, beforeDoc.getPages()[0]!)[0];
    expect(beforeDraw).toBeTruthy();
    const beforePx = decodeImageXObjectRgba(beforeDoc, beforeDraw!.ref);
    expect(beforePx).toBeTruthy();
    const midLeft = ((Math.floor(beforePx!.height / 2) * beforePx!.width + 1) * 4) | 0;
    expect(beforePx!.rgba[midLeft]).toBe(255);
    expect(beforePx!.rgba[midLeft + 1]).toBe(0);
    expect(beforePx!.rgba[midLeft + 2]).toBe(255);

    const erased = await applyPageMarks(bytes, [{ id: "e", page: 1, kind: "erase", ...imageLeft }]);
    const afterDoc = await PDFDocument.load(erased.slice());
    const afterDraw = listPageImageDraws(afterDoc, afterDoc.getPages()[0]!)[0];
    const afterPx = decodeImageXObjectRgba(afterDoc, afterDraw!.ref);
    expect(afterPx).toBeTruthy();
    const left = (Math.floor(afterPx!.height / 2) * afterPx!.width + 1) * 4;
    const right = (Math.floor(afterPx!.height / 2) * afterPx!.width + afterPx!.width - 2) * 4;
    expect(afterPx!.rgba[left]).toBe(0);
    expect(afterPx!.rgba[left + 1]).toBe(0);
    expect(afterPx!.rgba[left + 2]).toBe(0);
    expect(afterPx!.rgba[right]).toBe(0);
    expect(afterPx!.rgba[right + 1]).toBe(255);
    expect(afterPx!.rgba[right + 2]).toBe(255);
    const shown = (await listPageShownText(asBuffer(erased), 1)).join(" ");
    expect(shown).toMatch(/SECRET/);
  });

  it("removes an overlapping FreeText annotation from the source file", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("SECRET", { x: 20, y: 100, size: 18, font, color: rgb(0, 0, 0) });
    writeNativeAnnotations(doc, [
      { id: "n", page: 1, kind: "note", x: 16, y: 90, width: 90, height: 30, text: "SECRET leak" },
    ]);
    const src = await doc.save();
    expect(await listPageAnnotationSubtypes(src, 1)).toContain("FreeText");
    const erased = await applyPageMarks(src, [
      { id: "e", page: 1, kind: "erase", x: 16, y: 90, width: 90, height: 24 },
    ]);
    expect(await listPageAnnotationSubtypes(erased, 1)).not.toContain("FreeText");
    expect((await listPageShownText(asBuffer(erased), 1)).join(" ")).not.toMatch(/SECRET/);
  });

  it("runs through applyWorkshopPatches without restoring SECRET", async () => {
    const { bytes, secretBox } = await buildSecretPdf();
    const out = await applyWorkshopPatches(
      asBuffer(bytes),
      [],
      [],
      [{ id: "e", page: 1, kind: "erase", ...secretBox }],
    );
    expect((await listPageShownText(asBuffer(out), 1)).join(" ")).not.toMatch(/SECRET/);
    expect(await pdfJsText(out)).not.toMatch(/SECRET/);
  });

  it("leaves page 2 operators untouched", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([200, 200]);
    p1.drawText("SECRET", { x: 20, y: 100, size: 18, font, color: rgb(0, 0, 0) });
    const p2 = doc.addPage([200, 200]);
    p2.drawText("PAGE_TWO_KEEP", { x: 20, y: 100, size: 14, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();
    const erased = await applyPageMarks(bytes, [
      { id: "e", page: 1, kind: "erase", x: 16, y: 90, width: 90, height: 24 },
    ]);
    expect((await listPageShownText(asBuffer(erased), 1)).join(" ")).not.toMatch(/SECRET/);
    expect((await listPageShownText(asBuffer(erased), 2)).join(" ")).toContain("PAGE_TWO_KEEP");
  });

  it("strips SECRET from the committed redact-secret fixture", async () => {
    const bytes = fixture("redact-secret.pdf");
    const shownBefore = (await listPageShownText(asBuffer(bytes), 1)).join(" ");
    expect(shownBefore).toMatch(/SECRET/);
    expect(shownBefore).toMatch(/KEEP/);
    const erased = await applyPageMarks(bytes, [
      { id: "e", page: 1, kind: "erase", x: 38, y: 350, width: 90, height: 28 },
    ]);
    const shown = (await listPageShownText(asBuffer(erased), 1)).join(" ");
    expect(shown).not.toMatch(/SECRET/);
    expect(shown).toMatch(/KEEP/);
    expect(shown).toMatch(/VISIBLE/);
    expect(await pdfJsText(erased)).not.toMatch(/SECRET/);
  });
});

describe("applyPermanentRedaction no-op", () => {
  it("does nothing when there are no erase marks", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("SECRET", { x: 10, y: 40, size: 12, font });
    await applyPermanentRedaction(doc, [
      { id: "c", page: 1, kind: "redact", x: 8, y: 30, width: 50, height: 20 },
    ]);
    const bytes = await doc.save();
    expect((await listPageShownText(asBuffer(bytes), 1)).join(" ")).toContain("SECRET");
  });
});
