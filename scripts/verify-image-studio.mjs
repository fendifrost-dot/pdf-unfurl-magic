/**
 * Headless check: replace one photo in a PDF that also has text and a rule,
 * then confirm the original strings and line still exist in the file.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, rgb } from "pdf-lib";

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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "tmp/image-studio");

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a += bytes[i];
    if (a >= 65521) a -= 65521;
    b += a;
    if (b >= 65521) b -= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n) {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(8 + data.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = 1 + width * 4;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const max = 65535;
  const blocks = [];
  for (let offset = 0; offset < raw.length; offset += max) {
    const slice = raw.subarray(offset, Math.min(offset + max, raw.length));
    const last = offset + max >= raw.length;
    const block = new Uint8Array(5 + slice.length);
    block[0] = last ? 1 : 0;
    block[1] = slice.length & 0xff;
    block[2] = (slice.length >>> 8) & 0xff;
    const nlen = slice.length ^ 0xffff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >>> 8) & 0xff;
    block.set(slice, 5);
    blocks.push(block);
  }
  const zlib = new Uint8Array(2 + blocks.reduce((n, b) => n + b.length, 0) + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  let p = 2;
  for (const block of blocks) {
    zlib.set(block, p);
    p += block.length;
  }
  zlib.set(u32(adler32(raw)), p);

  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", zlib), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
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

const before = await PDFDocument.create();
const page = before.addPage([595, 842]);
const font = await before.embedFont(StandardFonts.Helvetica);
const oak = await before.embedPng(solidPng(160, 100, 168, 104, 52));
const kitchen = await before.embedPng(solidPng(140, 90, 88, 122, 148));
page.drawText("NORTHGATE_KEEP", { x: 56, y: 780, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
page.drawText("Quote line stays put.", { x: 56, y: 754, size: 11, font, color: rgb(0.3, 0.3, 0.3) });
page.drawImage(oak, { x: 360, y: 700, width: 180, height: 112 });
page.drawLine({ start: { x: 56, y: 680 }, end: { x: 539, y: 680 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
page.drawImage(kitchen, { x: 56, y: 480, width: 220, height: 140 });
page.drawText("LINE_ABOVE_TABLE", { x: 56, y: 660, size: 10, font });

const beforeBytes = await before.save();
const afterDoc = await PDFDocument.load(beforeBytes.slice(0));
const afterPage = afterDoc.getPages()[0];
const replacement = await afterDoc.embedPng(solidPng(160, 100, 40, 140, 90));
afterPage.drawRectangle({ x: 360, y: 700, width: 180, height: 112, color: rgb(1, 1, 1) });
afterPage.drawImage(replacement, { x: 360, y: 700, width: 180, height: 112 });
afterPage.drawRectangle({ x: 80, y: 500, width: 90, height: 28, color: rgb(0.05, 0.05, 0.05) });
const afterBytes = await afterDoc.save();

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "before.pdf"), beforeBytes);
await writeFile(join(outDir, "after.pdf"), afterBytes);

const reloaded = await PDFDocument.load(afterBytes.slice(0));
const afterPageContent = pageContent(reloaded.getPages()[0]);
assert(afterPageContent.includes(toHex("NORTHGATE_KEEP")), "export lost the heading text");
assert(afterPageContent.includes(toHex("LINE_ABOVE_TABLE")), "export lost the table caption");
assert(afterPageContent.includes(toHex("Quote line stays put.")), "export lost the supporting line");
assert(/56 680 m[\s\S]*539 680 l/.test(afterPageContent), "export lost the rule line");
assert(
  /1 0 0 1 80 500 cm[\s\S]*0\.05 0\.05 0\.05 rg/.test(afterPageContent) ||
    /0\.05 0\.05 0\.05 rg[\s\S]*80 500/.test(afterPageContent),
  "redact rectangle was not burned in",
);
const beforeText = new TextDecoder("latin1").decode(beforeBytes);
const afterText = new TextDecoder("latin1").decode(afterBytes);
const imagesBefore = beforeText.split("/Subtype /Image").length - 1;
const imagesAfter = afterText.split("/Subtype /Image").length - 1;
assert(imagesBefore >= 2, `expected two source photos, found ${imagesBefore}`);
assert(imagesAfter >= imagesBefore, "replacement image was not written");

console.log(
  `image-studio verify ok · before ${beforeBytes.length} bytes (${imagesBefore} images) · after ${afterBytes.length} bytes (${imagesAfter} images)`,
);
