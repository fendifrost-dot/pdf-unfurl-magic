/**
 * Headless check: replace one photo in a PDF that also has text and a rule,
 * then confirm the original XObject was updated (no white-rect overlay).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import { encodePng } from "../src/lib/tiny-png.ts";
import { applyWorkshopPatches } from "../src/lib/pdf-tools.ts";
import {
  countPageContentStreams,
  countPageDoOperators,
  listPageImageDraws,
  listPageImageXObjects,
} from "../src/lib/pdf-image-xobject.ts";
import { pageHasWhiteCover } from "../src/lib/pdf-text-edit.ts";

function pageContent(page) {
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((ref) => {
      const stream = page.doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return "";
      return new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    })
    .join("\n");
}

function toHex(text) {
  return Array.from(text)
    .map((ch) => ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))
    .join("");
}

function solidPng(width, height, r, g, b) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
  return encodePng(width, height, rgba);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function asBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "tmp/image-studio");

const before = await PDFDocument.create();
const page = before.addPage([595, 842]);
const font = await before.embedFont(StandardFonts.Helvetica);
const oak = await before.embedPng(solidPng(160, 100, 168, 104, 52));
const kitchen = await before.embedPng(solidPng(140, 90, 88, 122, 148));
page.drawText("NORTHGATE_KEEP", { x: 56, y: 780, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
page.drawText("Quote line stays put.", {
  x: 56,
  y: 754,
  size: 11,
  font,
  color: rgb(0.3, 0.3, 0.3),
});
page.drawImage(oak, { x: 360, y: 700, width: 180, height: 112 });
page.drawLine({
  start: { x: 56, y: 680 },
  end: { x: 539, y: 680 },
  thickness: 1,
  color: rgb(0.8, 0.8, 0.8),
});
page.drawImage(kitchen, { x: 56, y: 480, width: 220, height: 140 });
page.drawText("LINE_ABOVE_TABLE", { x: 56, y: 660, size: 10, font });

const beforeBytes = await before.save();
const beforeDoc = await PDFDocument.load(beforeBytes.slice(0));
const beforePage = beforeDoc.getPages()[0];
const oakDraw = listPageImageDraws(beforeDoc, beforePage).find(
  (draw) => Math.abs(draw.x - 360) < 1 && Math.abs(draw.y - 700) < 1,
);
assert(oakDraw, "could not locate the oak XObject");
const beforeDos = countPageDoOperators(beforeDoc, beforePage);
const beforeContents = countPageContentStreams(beforePage);
const beforeNames = listPageImageXObjects(beforeDoc, beforePage)
  .map((image) => image.name)
  .sort();

const afterBytes = await applyWorkshopPatches(
  asBuffer(beforeBytes),
  [],
  [
    {
      page: 1,
      x: oakDraw.x,
      y: oakDraw.y,
      width: oakDraw.widthPt,
      height: oakDraw.heightPt,
      bytes: solidPng(160, 100, 40, 140, 90),
      mime: "image/png",
      name: oakDraw.name,
    },
  ],
  [],
);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "before.pdf"), beforeBytes);
await writeFile(join(outDir, "after.pdf"), afterBytes);

const reloaded = await PDFDocument.load(afterBytes.slice(0));
const afterPage = reloaded.getPages()[0];
const afterPageContent = pageContent(afterPage);
assert(afterPageContent.includes(toHex("NORTHGATE_KEEP")), "export lost the heading text");
assert(afterPageContent.includes(toHex("LINE_ABOVE_TABLE")), "export lost the table caption");
assert(
  afterPageContent.includes(toHex("Quote line stays put.")),
  "export lost the supporting line",
);
assert(/56 680 m[\s\S]*539 680 l/.test(afterPageContent), "export lost the rule line");
assert(
  countPageDoOperators(reloaded, afterPage) === beforeDos,
  "page gained an extra Do (overlay)",
);
assert(
  countPageContentStreams(afterPage) === beforeContents,
  "page gained a stacked content stream",
);
assert(
  listPageImageXObjects(reloaded, afterPage)
    .map((image) => image.name)
    .sort()
    .join() === beforeNames.join(),
  "image resource names changed",
);
const afterOak = listPageImageXObjects(reloaded, afterPage).find(
  (image) => image.name === oakDraw.name,
);
assert(afterOak?.ref.objectNumber === oakDraw.ref.objectNumber, "XObject object number changed");
const covered = await pageHasWhiteCover(asBuffer(afterBytes), 1, {
  x: oakDraw.x,
  y: oakDraw.y,
  width: oakDraw.widthPt,
  height: oakDraw.heightPt,
});
assert(!covered, "export painted a TouchUp-style white rectangle");

console.log(
  `image-studio verify ok · before ${beforeBytes.length} bytes · after ${afterBytes.length} bytes · xobject ${oakDraw.name} #${oakDraw.ref.objectNumber}`,
);
