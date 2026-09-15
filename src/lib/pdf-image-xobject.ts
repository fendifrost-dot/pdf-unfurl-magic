/**
 * In-place image XObject replace.
 *
 * Acrobat TouchUp (and the previous Image Studio exporter) hid the original
 * photo under a white `re` and stacked a new `Do`. That duplicates the XObject,
 * bloats the file, and can smear layered docs. This path finds the existing
 * `/ImN` stream and reassigns it (pdf-lib #175 / pdfcpu `images update`).
 *
 * Overlay whiteout is only the fallback when no Image XObject can be identified
 * (inline `BI`…`EI` images, or a patch that matches nothing on the page).
 */
import {
  JpegEmbedder,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PngEmbedder,
  decodePDFRawStream,
} from "pdf-lib";
import { tokenizeContentStream, type Token } from "./pdf-content-stream";
import { jpegMagic, type ImagePatch } from "./pdf-images";

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const BBOX_IOU_MIN = 0.55;

export type PageImageXObject = {
  name: string;
  ref: PDFRef;
  width: number;
  height: number;
};

export type PageImageDraw = PageImageXObject & {
  x: number;
  y: number;
  widthPt: number;
  heightPt: number;
};

function copyBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

function decodeStream(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) {
    return decodePDFRawStream(stream).decode();
  }
  const withUnencoded = stream as PDFStream & { getUnencodedContents?: () => Uint8Array };
  if (typeof withUnencoded.getUnencodedContents === "function") {
    return withUnencoded.getUnencodedContents();
  }
  return stream.getContents();
}

function streamDict(stream: PDFStream | null): PDFDict | null {
  if (!stream) return null;
  if ("dict" in stream && stream.dict instanceof PDFDict) return stream.dict;
  return null;
}

function asStream(doc: PDFDocument, item: unknown): PDFStream | null {
  const obj = item instanceof PDFRef ? doc.context.lookup(item) : item;
  return obj instanceof PDFStream ? obj : null;
}

function asRef(item: unknown): PDFRef | null {
  return item instanceof PDFRef ? item : null;
}

function subtypeName(dict: PDFDict | null): string {
  if (!dict) return "";
  const subtype = dict.lookup(PDFName.of("Subtype"));
  return subtype instanceof PDFName ? subtype.decodeText() : "";
}

function asNumber(obj: unknown): number {
  if (typeof obj === "number") return obj;
  if (obj instanceof PDFNumber) return obj.asNumber();
  return 0;
}

function imagePixelSize(stream: PDFStream | null): { width: number; height: number } {
  const dict = streamDict(stream);
  if (!dict) return { width: 0, height: 0 };
  return {
    width: asNumber(dict.lookup(PDFName.of("Width"))),
    height: asNumber(dict.lookup(PDFName.of("Height"))),
  };
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function unitSquareBBox(ctm: Matrix): { x: number; y: number; width: number; height: number } {
  const corners = [
    applyMatrix(ctm, 0, 0),
    applyMatrix(ctm, 1, 0),
    applyMatrix(ctm, 1, 1),
    applyMatrix(ctm, 0, 1),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function iou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

function normalizeResourceName(name: string | undefined): string {
  if (!name) return "";
  return name.replace(/^\//, "").trim();
}

/** PDF.js operator-list ids and our inline fallback are not `/XObject` keys. */
function isUsableXObjectName(name: string): boolean {
  if (!name) return false;
  if (name.startsWith("inline-")) return false;
  if (/^img_p\d+_\d+$/i.test(name)) return false;
  if (/^g_\d+$/i.test(name)) return false;
  return true;
}

function formMatrix(dict: PDFDict | null): Matrix {
  const matrix = dict?.lookup(PDFName.of("Matrix"));
  if (matrix instanceof PDFArray && matrix.size() >= 6) {
    return [
      asNumber(matrix.get(0)),
      asNumber(matrix.get(1)),
      asNumber(matrix.get(2)),
      asNumber(matrix.get(3)),
      asNumber(matrix.get(4)),
      asNumber(matrix.get(5)),
    ];
  }
  return IDENTITY;
}

function pageContentStreams(doc: PDFDocument, page: PDFPage): PDFStream[] {
  const contents = page.node.Contents();
  if (!contents) return [];
  if (contents instanceof PDFArray) {
    const out: PDFStream[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const stream = asStream(doc, contents.get(i));
      if (stream) out.push(stream);
    }
    return out;
  }
  if (contents instanceof PDFStream) return [contents];
  return [];
}

function countContentStreams(page: PDFPage): number {
  const contents = page.node.Contents();
  if (!contents) return 0;
  if (contents instanceof PDFArray) return contents.size();
  return 1;
}

function lookupNamed(
  resources: PDFDict | null,
  name: string,
): { value: unknown; dict: PDFDict } | null {
  if (!resources || !name) return null;
  const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return null;
  const key = PDFName.of(name);
  if (!xobjects.has(key)) return null;
  return { value: xobjects.get(key), dict: xobjects };
}

function collectImageXObjects(
  doc: PDFDocument,
  resources: PDFDict | null,
  into: PageImageXObject[],
  seen: Set<number>,
) {
  const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return;
  for (const [name, value] of xobjects.entries()) {
    const ref = asRef(value);
    if (ref && seen.has(ref.objectNumber)) continue;
    if (ref) seen.add(ref.objectNumber);
    const stream = asStream(doc, value);
    if (!stream) continue;
    const subtype = subtypeName(streamDict(stream));
    if (subtype === "Image") {
      if (!ref) continue;
      const size = imagePixelSize(stream);
      into.push({ name: name.decodeText(), ref, width: size.width, height: size.height });
      continue;
    }
    if (subtype === "Form") {
      const formResources = streamDict(stream)?.lookupMaybe(PDFName.of("Resources"), PDFDict);
      collectImageXObjects(doc, formResources ?? null, into, seen);
    }
  }
}

function collectDrawsFromTokens(
  doc: PDFDocument,
  resources: PDFDict | null,
  tokens: Token[],
  startCtm: Matrix,
  into: PageImageDraw[],
  seenForms: Set<number>,
) {
  let ctm = startCtm;
  const stack: Matrix[] = [];
  const significant = tokens.filter((token) => token.kind !== "ws" && token.kind !== "comment");

  for (let i = 0; i < significant.length; i++) {
    const token = significant[i];
    if (token?.kind !== "op") continue;
    const op = String(token.value ?? token.raw);

    if (op === "q") {
      stack.push(ctm);
      continue;
    }
    if (op === "Q") {
      ctm = stack.pop() ?? IDENTITY;
      continue;
    }
    if (op === "cm") {
      const nums: number[] = [];
      for (let k = i - 6; k < i; k++) {
        const prev = significant[k];
        if (prev?.kind === "num" && typeof prev.value === "number") nums.push(prev.value);
      }
      if (nums.length === 6) {
        ctm = multiply(ctm, nums as Matrix);
      }
      continue;
    }
    if (op !== "Do") continue;

    const nameTok = significant[i - 1];
    if (nameTok?.kind !== "name") continue;
    const name = normalizeResourceName(String(nameTok.value ?? ""));
    const found = lookupNamed(resources, name);
    if (!found) continue;
    const stream = asStream(doc, found.value);
    const subtype = subtypeName(streamDict(stream));
    const bbox = unitSquareBBox(ctm);

    if (subtype === "Image") {
      const ref = asRef(found.value);
      if (!ref) continue;
      const size = imagePixelSize(stream);
      into.push({
        name,
        ref,
        width: size.width,
        height: size.height,
        x: bbox.x,
        y: bbox.y,
        widthPt: bbox.width,
        heightPt: bbox.height,
      });
      continue;
    }

    if (subtype === "Form" && stream) {
      const ref = asRef(found.value);
      if (ref) {
        if (seenForms.has(ref.objectNumber)) continue;
        seenForms.add(ref.objectNumber);
      }
      const formDict = streamDict(stream);
      const formResources = formDict?.lookupMaybe(PDFName.of("Resources"), PDFDict) ?? resources;
      const nestedCtm = multiply(ctm, formMatrix(formDict));
      collectDrawsFromTokens(
        doc,
        formResources ?? null,
        tokenizeContentStream(decodeStream(stream)),
        nestedCtm,
        into,
        seenForms,
      );
    }
  }
}

export function listPageImageXObjects(doc: PDFDocument, page: PDFPage): PageImageXObject[] {
  const out: PageImageXObject[] = [];
  collectImageXObjects(doc, page.node.Resources() ?? null, out, new Set());
  return out;
}

export function listPageImageDraws(doc: PDFDocument, page: PDFPage): PageImageDraw[] {
  const resources = page.node.Resources() ?? null;
  const draws: PageImageDraw[] = [];
  const seenForms = new Set<number>();
  for (const stream of pageContentStreams(doc, page)) {
    collectDrawsFromTokens(
      doc,
      resources,
      tokenizeContentStream(decodeStream(stream)),
      IDENTITY,
      draws,
      seenForms,
    );
  }
  return draws;
}

export function countPageDoOperators(doc: PDFDocument, page: PDFPage): number {
  let count = 0;
  for (const stream of pageContentStreams(doc, page)) {
    for (const token of tokenizeContentStream(decodeStream(stream))) {
      if (token.kind === "op" && (token.value === "Do" || token.raw === "Do")) count += 1;
    }
  }
  return count;
}

export function countPageContentStreams(page: PDFPage): number {
  return countContentStreams(page);
}

export function findPageImageXObject(
  doc: PDFDocument,
  page: PDFPage,
  patch: Pick<ImagePatch, "name" | "x" | "y" | "width" | "height">,
): PageImageXObject | null {
  const images = listPageImageXObjects(doc, page);
  if (images.length === 0) return null;

  const name = normalizeResourceName(patch.name);
  if (isUsableXObjectName(name)) {
    const named = images.find((image) => image.name === name);
    if (named) return named;
  }

  const patchBox = { x: patch.x, y: patch.y, width: patch.width, height: patch.height };
  if (patchBox.width > 0 && patchBox.height > 0) {
    const draws = listPageImageDraws(doc, page);
    let best: { draw: PageImageDraw; score: number } | null = null;
    for (const draw of draws) {
      const score = iou(patchBox, {
        x: draw.x,
        y: draw.y,
        width: draw.widthPt,
        height: draw.heightPt,
      });
      if (score < BBOX_IOU_MIN) continue;
      if (!best || score > best.score) best = { draw, score };
    }
    if (best) {
      return {
        name: best.draw.name,
        ref: best.draw.ref,
        width: best.draw.width,
        height: best.draw.height,
      };
    }
  }

  if (images.length === 1) return images[0] ?? null;
  return null;
}

function dropStaleMasks(doc: PDFDocument, ref: PDFRef) {
  const stream = asStream(doc, ref);
  const dict = streamDict(stream);
  if (!dict) return;
  for (const key of ["SMask", "Mask"]) {
    const name = PDFName.of(key);
    const value = dict.get(name);
    if (value instanceof PDFRef) doc.context.delete(value);
    dict.delete(name);
  }
}

async function embedIntoRef(
  doc: PDFDocument,
  ref: PDFRef,
  bytes: Uint8Array,
  mime: "image/jpeg" | "image/png",
) {
  const data = copyBytes(bytes);
  if (mime === "image/png") {
    const embedder = await PngEmbedder.for(data);
    await embedder.embedIntoContext(doc.context, ref);
    return;
  }
  const embedder = await JpegEmbedder.for(data);
  await embedder.embedIntoContext(doc.context, ref);
}

/**
 * Replace the existing image XObject stream in place.
 * @returns true when the original `/ImN` object was updated.
 */
export async function replaceImageXObject(
  doc: PDFDocument,
  page: PDFPage,
  patch: ImagePatch,
): Promise<boolean> {
  const hit = findPageImageXObject(doc, page, patch);
  if (!hit) return false;
  const mime = patch.mime ?? jpegMagic(patch.bytes);
  dropStaleMasks(doc, hit.ref);
  await embedIntoRef(doc, hit.ref, patch.bytes, mime);
  return true;
}
