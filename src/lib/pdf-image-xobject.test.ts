import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts, rgb } from "pdf-lib";
import { encodePng } from "./tiny-png";
import { applyWorkshopPatches, buildSamplePdf } from "./pdf-tools";
import {
  countPageContentStreams,
  countPageDoOperators,
  findPageImageXObject,
  listPageImageDraws,
  listPageImageXObjects,
  replaceImageXObject,
} from "./pdf-image-xobject";
import {
  decodePageContent,
  decodePageContentRaw,
  listPageShownText,
  pageHasWhiteCover,
} from "./pdf-text-edit";

const RED = encodePng(
  2,
  2,
  Uint8Array.from([200, 20, 20, 255, 200, 20, 20, 255, 200, 20, 20, 255, 200, 20, 20, 255]),
);
const GREEN = encodePng(
  3,
  1,
  Uint8Array.from([20, 180, 40, 255, 20, 180, 40, 255, 20, 180, 40, 255]),
);

/** 1×1 RGB JPEG (SOF0) that pdf-lib's JpegEmbedder accepts. */
const TINY_JPEG = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHR8eIh0aHyQiJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6qys7O0tba3uHmCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S0tba3uHnCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A9/ooooA//9k=",
    "base64",
  ),
);

function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../fixtures", name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function imageWidth(doc: PDFDocument, ref: PDFRef): number {
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream) && !(stream instanceof Object)) return 0;
  const dict = (stream as PDFRawStream).dict;
  const width = dict?.lookup(PDFName.of("Width"));
  return width instanceof PDFNumber ? width.asNumber() : 0;
}

function streamBytes(doc: PDFDocument, ref: PDFRef): Uint8Array {
  const stream = doc.context.lookup(ref);
  if (stream instanceof PDFRawStream) return stream.getContents();
  return new Uint8Array();
}

function countDo(raw: string): number {
  return (raw.match(/(?:^|[\s])Do(?:[\s]|$)/g) ?? []).length;
}

describe("in-place image XObject replace", () => {
  it("reassigns the existing XObject instead of painting a white rect + extra Do", async () => {
    const sample = await buildSamplePdf();
    const beforeDoc = await PDFDocument.load(sample.slice());
    const beforePage = beforeDoc.getPages()[0]!;
    const kitchen = listPageImageDraws(beforeDoc, beforePage).find(
      (draw) => Math.abs(draw.x - 56) < 1 && Math.abs(draw.y - 318) < 1,
    );
    expect(kitchen).toBeTruthy();

    const beforeRef = kitchen!.ref.objectNumber;
    const beforeContents = countPageContentStreams(beforePage);
    const beforeDos = countPageDoOperators(beforeDoc, beforePage);
    const beforeImages = listPageImageXObjects(beforeDoc, beforePage);
    const originalBytes = Uint8Array.from(streamBytes(beforeDoc, kitchen!.ref));

    const out = await applyWorkshopPatches(
      asBuffer(sample),
      [],
      [
        {
          page: 1,
          x: kitchen!.x,
          y: kitchen!.y,
          width: kitchen!.widthPt,
          height: kitchen!.heightPt,
          bytes: RED,
          mime: "image/png",
          name: kitchen!.name,
        },
      ],
      [],
    );

    const afterDoc = await PDFDocument.load(out.slice());
    const afterPage = afterDoc.getPages()[0]!;
    const afterImages = listPageImageXObjects(afterDoc, afterPage);
    const replaced = afterImages.find((image) => image.name === kitchen!.name);

    expect(replaced?.ref.objectNumber).toBe(beforeRef);
    expect(afterImages.map((image) => image.name).sort()).toEqual(
      beforeImages.map((image) => image.name).sort(),
    );
    expect(countPageContentStreams(afterPage)).toBe(beforeContents);
    expect(countPageDoOperators(afterDoc, afterPage)).toBe(beforeDos);
    expect(imageWidth(afterDoc, replaced!.ref)).toBe(2);
    expect(
      Buffer.from(streamBytes(afterDoc, replaced!.ref)).equals(Buffer.from(originalBytes)),
    ).toBe(false);

    const box = {
      x: kitchen!.x,
      y: kitchen!.y,
      width: kitchen!.widthPt,
      height: kitchen!.heightPt,
    };
    expect(await pageHasWhiteCover(asBuffer(out), 1, box)).toBe(false);

    const shown = await listPageShownText(asBuffer(out), 1);
    expect(shown).toContain("Northgate Joinery");
    expect(shown).toContain("1,987.00");
    expect(shown).toContain("Finished bench — client reference. Fix the photo, not the page.");

    const raw = await decodePageContentRaw(asBuffer(out), 1);
    expect(raw).toMatch(/56 308 m[\s\S]*276 308 l/);
    expect(raw).not.toMatch(/1 1 1 rg[\s\S]*\/Image-\d+ Do/);
  });

  it("matches the clicked photo by bbox when the name is a PDF.js img_p* id", async () => {
    const sample = await buildSamplePdf();
    const beforeDoc = await PDFDocument.load(sample.slice());
    const oak = listPageImageDraws(beforeDoc, beforeDoc.getPages()[0]!).find(
      (draw) => Math.abs(draw.x - 390) < 1 && Math.abs(draw.y - 708) < 1,
    );
    expect(oak).toBeTruthy();
    const kitchen = listPageImageDraws(beforeDoc, beforeDoc.getPages()[0]!).find(
      (draw) => Math.abs(draw.x - 56) < 1,
    );
    expect(kitchen).toBeTruthy();

    const oakBefore = Uint8Array.from(streamBytes(beforeDoc, oak!.ref));
    const kitchenBefore = Uint8Array.from(streamBytes(beforeDoc, kitchen!.ref));

    const out = await applyWorkshopPatches(
      asBuffer(sample),
      [],
      [
        {
          page: 1,
          x: oak!.x,
          y: oak!.y,
          width: oak!.widthPt,
          height: oak!.heightPt,
          bytes: GREEN,
          mime: "image/png",
          name: "img_p0_1",
        },
      ],
      [],
    );

    const afterDoc = await PDFDocument.load(out.slice());
    const afterPage = afterDoc.getPages()[0]!;
    const oakAfter = listPageImageXObjects(afterDoc, afterPage).find(
      (image) => image.name === oak!.name,
    );
    const kitchenAfter = listPageImageXObjects(afterDoc, afterPage).find(
      (image) => image.name === kitchen!.name,
    );

    expect(oakAfter?.ref.objectNumber).toBe(oak!.ref.objectNumber);
    expect(imageWidth(afterDoc, oakAfter!.ref)).toBe(3);
    expect(Buffer.from(streamBytes(afterDoc, oakAfter!.ref)).equals(Buffer.from(oakBefore))).toBe(
      false,
    );
    expect(
      Buffer.from(streamBytes(afterDoc, kitchenAfter!.ref)).equals(Buffer.from(kitchenBefore)),
    ).toBe(true);
    expect(
      await pageHasWhiteCover(asBuffer(out), 1, {
        x: oak!.x,
        y: oak!.y,
        width: oak!.widthPt,
        height: oak!.heightPt,
      }),
    ).toBe(false);
  });

  it("updates the committed image-and-text fixture without a TouchUp whiteout", async () => {
    const source = fixture("image-and-text.pdf");
    const beforeDoc = await PDFDocument.load(source.slice(0));
    const beforePage = beforeDoc.getPages()[0]!;
    const images = listPageImageXObjects(beforeDoc, beforePage);
    expect(images).toHaveLength(1);
    const draw = listPageImageDraws(beforeDoc, beforePage)[0];
    expect(draw).toBeTruthy();
    const beforeDos = countPageDoOperators(beforeDoc, beforePage);

    const out = await applyWorkshopPatches(
      source,
      [],
      [
        {
          page: 1,
          x: draw!.x,
          y: draw!.y,
          width: draw!.widthPt,
          height: draw!.heightPt,
          bytes: RED,
          mime: "image/png",
          name: draw!.name,
        },
      ],
      [],
    );

    const afterDoc = await PDFDocument.load(out.slice());
    const afterPage = afterDoc.getPages()[0]!;
    const afterImages = listPageImageXObjects(afterDoc, afterPage);
    expect(afterImages).toHaveLength(1);
    expect(afterImages[0]?.ref.objectNumber).toBe(images[0]?.ref.objectNumber);
    expect(countPageDoOperators(afterDoc, afterPage)).toBe(beforeDos);
    expect(countPageContentStreams(afterPage)).toBe(countPageContentStreams(beforePage));
    expect(
      await pageHasWhiteCover(asBuffer(out), 1, {
        x: draw!.x,
        y: draw!.y,
        width: draw!.widthPt,
        height: draw!.heightPt,
      }),
    ).toBe(false);

    const shown = await listPageShownText(asBuffer(out), 1);
    expect(shown).toContain("REPLACE_ME: photo note");
    expect(shown).toContain("PDF Relief fixture: image + text");
  });

  it("replaces a JPEG XObject in place (Image Studio export mime)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const photo = await doc.embedJpg(TINY_JPEG);
    page.drawText("KEEP_CAPTION", { x: 40, y: 360, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawImage(photo, { x: 40, y: 80, width: 200, height: 200 });
    page.drawLine({
      start: { x: 40, y: 70 },
      end: { x: 240, y: 70 },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.7),
    });
    const bytes = await doc.save();

    const loaded = await PDFDocument.load(bytes.slice());
    const hit = listPageImageXObjects(loaded, loaded.getPages()[0]!)[0];
    expect(hit).toBeTruthy();

    const out = await applyWorkshopPatches(
      asBuffer(bytes),
      [],
      [
        {
          page: 1,
          x: 40,
          y: 80,
          width: 200,
          height: 200,
          bytes: TINY_JPEG,
          mime: "image/jpeg",
          name: hit!.name,
        },
      ],
      [],
    );

    const after = await PDFDocument.load(out.slice());
    const afterPage = after.getPages()[0]!;
    const afterHit = listPageImageXObjects(after, afterPage)[0];
    expect(afterHit?.ref.objectNumber).toBe(hit!.ref.objectNumber);
    expect(countPageDoOperators(after, afterPage)).toBe(
      countPageDoOperators(loaded, loaded.getPages()[0]!),
    );
    expect(
      await pageHasWhiteCover(asBuffer(out), 1, { x: 40, y: 80, width: 200, height: 200 }),
    ).toBe(false);
    expect(await listPageShownText(asBuffer(out), 1)).toContain("KEEP_CAPTION");
    const raw = await decodePageContentRaw(asBuffer(out), 1);
    expect(raw).toMatch(/40 70 m[\s\S]*240 70 l/);
    expect(countDo(raw)).toBe(1);
  });

  it("falls back to a white overlay only when no XObject can be identified", async () => {
    const sample = await buildSamplePdf();
    const beforeDoc = await PDFDocument.load(sample.slice());
    const beforePage = beforeDoc.getPages()[0]!;
    const beforeDos = countPageDoOperators(beforeDoc, beforePage);
    const beforeContents = countPageContentStreams(beforePage);

    const box = { x: 10, y: 10, width: 40, height: 30 };
    const out = await applyWorkshopPatches(
      asBuffer(sample),
      [],
      [
        {
          page: 1,
          ...box,
          bytes: RED,
          mime: "image/png",
          name: "inline-1-0",
        },
      ],
      [],
    );

    const afterDoc = await PDFDocument.load(out.slice());
    const afterPage = afterDoc.getPages()[0]!;
    expect(countPageDoOperators(afterDoc, afterPage)).toBeGreaterThan(beforeDos);
    expect(countPageContentStreams(afterPage)).toBeGreaterThan(beforeContents);
    expect(listPageImageXObjects(afterDoc, afterPage).length).toBeGreaterThan(
      listPageImageXObjects(beforeDoc, beforePage).length,
    );
    const raw = await decodePageContentRaw(asBuffer(out), 1);
    expect(raw).toMatch(/1 1 1 rg[\s\S]*\/Image-\d+ Do/);
    expect(await listPageShownText(asBuffer(out), 1)).toContain("Northgate Joinery");
  });

  it("leaves neighbouring text edits on the in-place text path", async () => {
    const sample = await buildSamplePdf();
    const beforeDoc = await PDFDocument.load(sample.slice());
    const kitchen = listPageImageDraws(beforeDoc, beforeDoc.getPages()[0]!).find(
      (draw) => Math.abs(draw.x - 56) < 1 && Math.abs(draw.y - 318) < 1,
    );
    expect(kitchen).toBeTruthy();

    const out = await applyWorkshopPatches(
      asBuffer(sample),
      [
        {
          page: 1,
          x: 490,
          y: 0,
          width: 60,
          height: 14,
          fontSize: 11,
          text: "2,257.00",
          originalText: "1,987.00",
          fontFamily: "Helvetica",
        },
      ],
      [
        {
          page: 1,
          x: kitchen!.x,
          y: kitchen!.y,
          width: kitchen!.widthPt,
          height: kitchen!.heightPt,
          bytes: RED,
          mime: "image/png",
          name: kitchen!.name,
        },
      ],
      [],
    );

    const shown = await listPageShownText(asBuffer(out), 1);
    expect(shown).toContain("2,257.00");
    expect(shown).not.toContain("1,987.00");
    expect(shown).toContain("Total due");
    expect(
      await pageHasWhiteCover(asBuffer(out), 1, {
        x: kitchen!.x,
        y: kitchen!.y,
        width: kitchen!.widthPt,
        height: kitchen!.heightPt,
      }),
    ).toBe(false);
    expect(await decodePageContent(asBuffer(out), 2)).toContain("REF-4421");
  });

  it("findPageImageXObject prefers a real resource name over bbox", async () => {
    const sample = await buildSamplePdf();
    const doc = await PDFDocument.load(sample.slice());
    const page = doc.getPages()[0]!;
    const oak = listPageImageDraws(doc, page).find((draw) => Math.abs(draw.x - 390) < 1);
    const kitchen = listPageImageDraws(doc, page).find((draw) => Math.abs(draw.x - 56) < 1);
    expect(oak && kitchen).toBeTruthy();

    const hit = findPageImageXObject(doc, page, {
      name: oak!.name,
      x: kitchen!.x,
      y: kitchen!.y,
      width: kitchen!.widthPt,
      height: kitchen!.heightPt,
    });
    expect(hit?.name).toBe(oak!.name);
    expect(hit?.ref.objectNumber).toBe(oak!.ref.objectNumber);

    const replaced = await replaceImageXObject(doc, page, {
      page: 1,
      x: kitchen!.x,
      y: kitchen!.y,
      width: kitchen!.widthPt,
      height: kitchen!.heightPt,
      bytes: RED,
      mime: "image/png",
      name: oak!.name,
    });
    expect(replaced).toBe(true);
    expect(imageWidth(doc, oak!.ref)).toBe(2);
  });
});
