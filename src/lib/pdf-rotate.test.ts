import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";
import {
  addRotateDeg,
  applyPageRotations,
  displayPageRotation,
  invertAffine,
  listPageRotations,
  normalizeRotateDeg,
  pageRotationOf,
  pdfPointToViewport,
  pdfRectToViewportBox,
  pdfjsPageViewport,
  pendingRotationCount,
  rotatePagesBy,
  sessionRotationList,
  stepSessionRotation,
  viewportPointToPdf,
  viewBoxFromSize,
  type PageRotateDeg,
} from "./pdf-rotate";
import { applyTextPatches, applyWorkshopPatches, buildSamplePdf } from "./pdf-tools";
import { bytesToArrayBuffer } from "./pdf-io";
import { listPageShownText } from "./pdf-text-edit";
import {
  buildSampleAcroFormPdf,
  fillAndFlattenAcroForm,
  inspectAcroForm,
  listWidgetSubtypes,
} from "./pdf-acroform";

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytesToArrayBuffer(bytes);
}

async function loadFixture(name: string): Promise<ArrayBuffer> {
  const buf = await readFile(join(process.cwd(), "fixtures", name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function rotationsOf(bytes: Uint8Array | ArrayBuffer): Promise<PageRotateDeg[]> {
  const buf = bytes instanceof Uint8Array ? asBuffer(bytes) : bytes;
  return listPageRotations(buf);
}

describe("rotate helpers", () => {
  it("normalizes any multiple of 90 into 0/90/180/270", () => {
    expect(normalizeRotateDeg(0)).toBe(0);
    expect(normalizeRotateDeg(90)).toBe(90);
    expect(normalizeRotateDeg(180)).toBe(180);
    expect(normalizeRotateDeg(270)).toBe(270);
    expect(normalizeRotateDeg(360)).toBe(0);
    expect(normalizeRotateDeg(450)).toBe(90);
    expect(normalizeRotateDeg(-90)).toBe(270);
    expect(normalizeRotateDeg(-180)).toBe(180);
    expect(normalizeRotateDeg(91)).toBe(90);
    expect(normalizeRotateDeg(Number.NaN)).toBe(0);
  });

  it("adds clockwise and counter-clockwise steps", () => {
    expect(addRotateDeg(0, 90)).toBe(90);
    expect(addRotateDeg(90, 90)).toBe(180);
    expect(addRotateDeg(180, 90)).toBe(270);
    expect(addRotateDeg(270, 90)).toBe(0);
    expect(addRotateDeg(0, -90)).toBe(270);
    expect(addRotateDeg(0, 180)).toBe(180);
    expect(addRotateDeg(90, 180)).toBe(270);
    expect(addRotateDeg(270, 180)).toBe(90);
  });

  it("drops a session rotation once it matches the original angle", () => {
    let session: Record<number, PageRotateDeg> = {};
    session = stepSessionRotation(session, 2, 0, 90);
    expect(displayPageRotation(session, 2, 0)).toBe(90);
    expect(sessionRotationList(session)).toEqual([{ page: 2, degrees: 90 }]);
    expect(pendingRotationCount(session)).toBe(1);
    expect(displayPageRotation(session, 1, 0)).toBe(0);

    session = stepSessionRotation(session, 2, 0, 90);
    session = stepSessionRotation(session, 2, 0, 90);
    session = stepSessionRotation(session, 2, 0, 90);
    expect(sessionRotationList(session)).toEqual([]);
    expect(pendingRotationCount(session)).toBe(0);
  });
});

describe("pdf.js-compatible viewport math", () => {
  const box = viewBoxFromSize(200, 100);
  const scale = 2;

  it("maps user-space origin to CSS for each /Rotate", () => {
    expect(pdfPointToViewport(0, 0, box, scale, 0)).toEqual({ x: 0, y: 200 });
    expect(pdfPointToViewport(0, 0, box, scale, 90)).toEqual({ x: 0, y: 0 });
    expect(pdfPointToViewport(0, 0, box, scale, 180)).toEqual({ x: 400, y: 0 });
    expect(pdfPointToViewport(0, 0, box, scale, 270)).toEqual({ x: 200, y: 400 });
  });

  it("round-trips PDF ↔ viewport points at 0/90/180/270", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const src = { x: 40, y: 25 };
      const vp = pdfPointToViewport(src.x, src.y, box, scale, rotation);
      const back = viewportPointToPdf(vp.x, vp.y, box, scale, rotation);
      expect(back.x).toBeCloseTo(src.x, 10);
      expect(back.y).toBeCloseTo(src.y, 10);
    }
  });

  it("swaps displayed width/height at 90 and 270", () => {
    expect(pdfjsPageViewport(box, 1, 0)).toMatchObject({ width: 200, height: 100 });
    expect(pdfjsPageViewport(box, 1, 90)).toMatchObject({ width: 100, height: 200 });
    expect(pdfjsPageViewport(box, 1, 180)).toMatchObject({ width: 200, height: 100 });
    expect(pdfjsPageViewport(box, 1, 270)).toMatchObject({ width: 100, height: 200 });
  });

  it("projects a PDF rect to an axis-aligned CSS box", () => {
    const rotated = pdfRectToViewportBox(10, 20, 30, 10, box, 1, 90);
    expect(rotated.x).toBeCloseTo(20);
    expect(rotated.y).toBeCloseTo(10);
    expect(rotated.width).toBeCloseTo(10);
    expect(rotated.height).toBeCloseTo(30);
  });

  it("inverts the identity-like 0° transform", () => {
    const { transform } = pdfjsPageViewport(box, 1, 0);
    const inv = invertAffine(transform);
    const p = applyRoundTrip(inv, transform, 12, 34);
    expect(p.x).toBeCloseTo(12);
    expect(p.y).toBeCloseTo(34);
  });
});

function applyRoundTrip(
  a: [number, number, number, number, number, number],
  b: [number, number, number, number, number, number],
  x: number,
  y: number,
) {
  const midX = b[0] * x + b[2] * y + b[4];
  const midY = b[1] * x + b[3] * y + b[5];
  return {
    x: a[0] * midX + a[2] * midY + a[4],
    y: a[1] * midX + a[3] * midY + a[5],
  };
}

describe("applyPageRotations × multi-page.pdf", () => {
  it("rotates page 2 by 90° and leaves pages 1 and 3 at 0", async () => {
    const source = await loadFixture("multi-page.pdf");
    const sourceCopy = source.slice(0);
    const before = await rotationsOf(source);
    expect(before).toEqual([0, 0, 0]);

    const exported = await rotatePagesBy(source, [2], 90);
    expect(await rotationsOf(exported)).toEqual([0, 90, 0]);

    const reopened = await PDFDocument.load(exported.slice());
    expect(pageRotationOf(reopened.getPages()[0]!)).toBe(0);
    expect(pageRotationOf(reopened.getPages()[1]!)).toBe(90);
    expect(pageRotationOf(reopened.getPages()[2]!)).toBe(0);
    expect(reopened.getPages()[1]!.node.lookup(PDFName.of("Rotate"))).toBeTruthy();

    expect(await listPageShownText(asBuffer(exported), 1)).toContain("PAGE_MARKER_1");
    expect(await listPageShownText(asBuffer(exported), 2)).toContain("PAGE_MARKER_2");
    expect(await listPageShownText(asBuffer(exported), 3)).toContain("PAGE_MARKER_3");

    expect(new Uint8Array(source)).toEqual(new Uint8Array(sourceCopy));
  });

  it("sets an absolute /Rotate without touching other pages", async () => {
    const source = await loadFixture("multi-page.pdf");
    const exported = await applyPageRotations(source, [{ page: 2, degrees: 180 }]);
    expect(await rotationsOf(exported)).toEqual([0, 180, 0]);
  });

  it("accumulates on a page that already has /Rotate", async () => {
    const source = await loadFixture("multi-page.pdf");
    const once = await rotatePagesBy(source, [2], 90);
    const twice = await rotatePagesBy(asBuffer(once), [2], 90);
    expect(await rotationsOf(twice)).toEqual([0, 180, 0]);
    const around = await rotatePagesBy(asBuffer(twice), [2], 180);
    expect(await rotationsOf(around)).toEqual([0, 0, 0]);
  });
});

describe("rotate keeps text edit and forms intact", () => {
  it("still rewrites REPLACE_ME after a 90° page rotate", async () => {
    const source = await loadFixture("simple-text.pdf");
    const rotated = await rotatePagesBy(source, [1], 90);
    expect(await rotationsOf(rotated)).toEqual([90]);
    const patched = await applyTextPatches(asBuffer(rotated), [
      {
        page: 1,
        x: 56,
        y: 710,
        width: 240,
        height: 14,
        fontSize: 12,
        text: "ROTATE_KEEP",
        originalText: "REPLACE_ME: workshop docket 118",
      },
    ]);
    const shown = await listPageShownText(asBuffer(patched), 1);
    expect(shown.join(" ")).toContain("ROTATE_KEEP");
    expect(shown.join(" ")).not.toContain("REPLACE_ME");
    expect(await rotationsOf(patched)).toEqual([90]);
  });

  it("keeps AcroForm widgets fillable after rotate, then flattens on export", async () => {
    const source = await buildSampleAcroFormPdf();
    const rotated = await rotatePagesBy(asBuffer(source), [1], 270);
    expect(await rotationsOf(rotated)).toEqual([270]);
    const report = await inspectAcroForm(asBuffer(rotated));
    expect(report.hasAcroForm).toBe(true);
    expect(report.fillableCount).toBeGreaterThanOrEqual(5);
    expect(await listWidgetSubtypes(asBuffer(rotated))).toContain("Widget");

    const { bytes, result } = await fillAndFlattenAcroForm(asBuffer(rotated), {
      values: { fullName: "Jordan Vega", city: "Redwood" },
      flatten: true,
    });
    expect(result.filled).toBeGreaterThan(0);
    expect(result.flattened).toBe(true);
    const shown = await listPageShownText(asBuffer(bytes), 1);
    expect(shown.join(" ")).toContain("Jordan Vega");
    expect(await rotationsOf(bytes)).toEqual([270]);
    expect(await listWidgetSubtypes(asBuffer(bytes))).not.toContain("Widget");
  });

  it("applyWorkshopPatches writes /Rotate and does not flatten neighbouring text", async () => {
    const sample = await buildSamplePdf();
    const out = await applyWorkshopPatches(asBuffer(sample), [], [], [], [], null, [
      { page: 2, degrees: 90 },
    ]);
    expect(await rotationsOf(out)).toEqual([0, 90, 0]);
    expect(await listPageShownText(asBuffer(out), 2)).toContain("UNTOUCHED PAGE");
    expect(await listPageShownText(asBuffer(out), 1)).toContain("Northgate Joinery");
  });
});

describe("pdf-lib setRotation on a built page", () => {
  it("round-trips getRotation after setRotation", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 400]);
    page.drawText("KEEP_STREAM", { x: 40, y: 300, size: 12, font, color: rgb(0, 0, 0) });
    page.setRotation(degrees(90));
    expect(page.getRotation().angle).toBe(90);
    const bytes = await doc.save();
    const reopened = await PDFDocument.load(bytes.slice());
    expect(pageRotationOf(reopened.getPages()[0]!)).toBe(90);
    expect(await listPageShownText(asBuffer(bytes), 1)).toContain("KEEP_STREAM");
  });
});
