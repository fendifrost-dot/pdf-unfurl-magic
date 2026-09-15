/**
 * Thin adapter over pdf.js AnnotationEditorLayer save semantics
 * (PRIOR_ART.md #5). Workshop highlight / note marks serialize like Mozilla's
 * editors (`annotationType` + `pageIndex` + `rect`) and are written with
 * `PDFDocumentProxy.saveDocument()` as real PDF annotations.
 *
 * We do not mount AnnotationEditorLayer in the React viewer (minimal UI).
 * Keys must use `pdfjs_internal_editor_` so the worker's getNewAnnotationsMap
 * picks them up. Underline / rectangle have no 4.10 editor type — those are
 * native annot dicts. Redact stays a visual burn in pdf-marks.ts.
 */
import { PDFDict, PDFDocument, PDFName, type PDFPage } from "pdf-lib";
import type { AnnotationBurn } from "./pdf-images";

/** pdfjs-dist@4.10.38 AnnotationEditorPrefix */
export const PDFJS_EDITOR_PREFIX = "pdfjs_internal_editor_";

/** pdfjs-dist@4.10.38 AnnotationEditorType */
export const PdfJsEditorType = {
  FREETEXT: 3,
  HIGHLIGHT: 9,
  STAMP: 13,
  INK: 15,
} as const;

export type EditorSaveVia = "pdfjs-saveDocument" | "pdf-lib-dicts";

export type EditorSaveResult = {
  bytes: Uint8Array;
  via: EditorSaveVia;
};

export type PdfJsEditorPayload = {
  annotationType: number;
  pageIndex: number;
  rect: [number, number, number, number];
  rotation: number;
  color: [number, number, number];
  opacity?: number;
  thickness?: number;
  fontSize?: number;
  value?: string;
  quadPoints?: number[];
  outlines?: number[][];
};

export type StoredEditorMark = {
  key: string;
  value: PdfJsEditorPayload;
};

const HIGHLIGHT_RGB: [number, number, number] = [255, 219, 51];
const NOTE_RGB: [number, number, number] = [46, 36, 20];
const UNDERLINE_RGB: [number, number, number] = [184, 41, 31];
const RECT_RGB: [number, number, number] = [122, 69, 36];
const HIGHLIGHT_OPACITY = 0.34;

export function partitionMarks(marks: AnnotationBurn[]): {
  burn: AnnotationBurn[];
  editor: AnnotationBurn[];
  native: AnnotationBurn[];
} {
  const burn: AnnotationBurn[] = [];
  const editor: AnnotationBurn[] = [];
  const native: AnnotationBurn[] = [];
  for (const mark of marks) {
    if (mark.kind === "redact") burn.push(mark);
    else if (mark.kind === "highlight" || mark.kind === "note") editor.push(mark);
    else native.push(mark);
  }
  return { burn, editor, native };
}

export function markRect(mark: AnnotationBurn): [number, number, number, number] {
  const x = mark.x;
  const y = mark.y;
  const x2 = mark.x + Math.max(1, mark.width);
  const y2 = mark.y + Math.max(1, mark.height);
  return [Math.min(x, x2), Math.min(y, y2), Math.max(x, x2), Math.max(y, y2)];
}

function adobeQuadPoints(rect: [number, number, number, number]): number[] {
  const [x1, y1, x2, y2] = rect;
  // tL, tR, bL, bR — Acrobat / pdf.js HighlightEditor order.
  return [x1, y2, x2, y2, x1, y1, x2, y1];
}

function outlineForRect(rect: [number, number, number, number]): number[] {
  const [x1, y1, x2, y2] = rect;
  return [x1, y1, x2, y1, x2, y2, x1, y2];
}

export function serializeEditorMarks(marks: AnnotationBurn[]): StoredEditorMark[] {
  const stored: StoredEditorMark[] = [];
  let index = 0;
  for (const mark of marks) {
    if (mark.kind !== "highlight" && mark.kind !== "note") continue;
    const rect = markRect(mark);
    const pageIndex = Math.max(0, mark.page - 1);
    if (mark.kind === "highlight") {
      stored.push({
        key: `${PDFJS_EDITOR_PREFIX}${index++}`,
        value: {
          annotationType: PdfJsEditorType.HIGHLIGHT,
          color: HIGHLIGHT_RGB,
          opacity: HIGHLIGHT_OPACITY,
          thickness: 0,
          quadPoints: adobeQuadPoints(rect),
          outlines: [outlineForRect(rect)],
          pageIndex,
          rect,
          rotation: 0,
        },
      });
      continue;
    }
    stored.push({
      key: `${PDFJS_EDITOR_PREFIX}${index++}`,
      value: {
        annotationType: PdfJsEditorType.FREETEXT,
        color: NOTE_RGB,
        fontSize: 8,
        value: (mark.text ?? "").trim() || "Note",
        pageIndex,
        rect,
        rotation: 0,
      },
    });
  }
  return stored;
}

function pdfDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function addAnnotDict(page: PDFPage, dict: PDFDict) {
  const ref = page.doc.context.register(dict);
  let annots = page.node.Annots();
  if (!annots) {
    annots = page.doc.context.obj([]);
    page.node.set(PDFName.of("Annots"), annots);
  }
  annots.push(ref);
}

function rgb01(rgb: [number, number, number]): [number, number, number] {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

function writeHighlightDict(page: PDFPage, mark: AnnotationBurn) {
  const rect = markRect(mark);
  const dict = page.doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Highlight"),
    Rect: rect,
    QuadPoints: adobeQuadPoints(rect),
    C: rgb01(HIGHLIGHT_RGB),
    CA: HIGHLIGHT_OPACITY,
    F: 4,
    Border: [0, 0, 0],
    CreationDate: pdfDate(),
    T: "PDF Relief",
  });
  addAnnotDict(page, dict);
}

function writeFreeTextDict(page: PDFPage, mark: AnnotationBurn) {
  const rect = markRect(mark);
  const value = (mark.text ?? "").trim() || "Note";
  const dict = page.doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("FreeText"),
    Rect: rect,
    Contents: value,
    DA: "/Helv 8 Tf 0.18 0.14 0.08 rg",
    F: 4,
    Border: [0, 0, 0],
    CreationDate: pdfDate(),
    T: "PDF Relief",
  });
  addAnnotDict(page, dict);
}

function writeUnderlineDict(page: PDFPage, mark: AnnotationBurn) {
  const rect = markRect(mark);
  const dict = page.doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Underline"),
    Rect: rect,
    QuadPoints: adobeQuadPoints(rect),
    C: rgb01(UNDERLINE_RGB),
    F: 4,
    Border: [0, 0, 0],
    CreationDate: pdfDate(),
    T: "PDF Relief",
  });
  addAnnotDict(page, dict);
}

function writeSquareDict(page: PDFPage, mark: AnnotationBurn) {
  const rect = markRect(mark);
  const dict = page.doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Square"),
    Rect: rect,
    C: rgb01(RECT_RGB),
    F: 4,
    BS: { W: 1.35, S: PDFName.of("S") },
    CreationDate: pdfDate(),
    T: "PDF Relief",
  });
  addAnnotDict(page, dict);
}

export function writeNativeAnnotations(doc: PDFDocument, marks: AnnotationBurn[]) {
  const pages = doc.getPages();
  for (const mark of marks) {
    const page = pages[mark.page - 1];
    if (!page) continue;
    if (mark.kind === "underline") writeUnderlineDict(page, mark);
    else if (mark.kind === "rect") writeSquareDict(page, mark);
    else if (mark.kind === "highlight") writeHighlightDict(page, mark);
    else if (mark.kind === "note") writeFreeTextDict(page, mark);
  }
}

export async function listPageAnnotationSubtypes(
  bytes: ArrayBuffer | Uint8Array,
  pageNumber: number,
): Promise<string[]> {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await PDFDocument.load(src.slice(), { ignoreEncryption: true });
  const page = doc.getPages()[pageNumber - 1];
  if (!page) return [];
  const annots = page.node.Annots();
  if (!annots) return [];
  const out: string[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const item = annots.get(i);
    const dict = doc.context.lookup(item);
    if (!(dict instanceof PDFDict)) continue;
    const subtype = dict.lookup(PDFName.of("Subtype"));
    if (subtype instanceof PDFName) out.push(subtype.decodeText());
  }
  return out;
}

async function loadPdfJs() {
  if (typeof window === "undefined") {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
    }
    return pdfjs;
  }
  const { getPdfJs } = await import("./pdf-runtime");
  return getPdfJs();
}

async function saveWithPdfJs(bytes: Uint8Array, marks: AnnotationBurn[]): Promise<Uint8Array> {
  const stored = serializeEditorMarks(marks);
  if (!stored.length) return bytes;

  const pdfjs = await loadPdfJs();
  const data = bytes.slice();
  const proxy = await pdfjs.getDocument({
    data,
    annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE,
  }).promise;
  try {
    for (const { key, value } of stored) {
      proxy.annotationStorage.setValue(key, value);
    }
    const saved = await proxy.saveDocument();
    return saved instanceof Uint8Array ? saved : new Uint8Array(saved);
  } finally {
    await proxy.destroy();
  }
}

function expectedEditorSubtypes(marks: AnnotationBurn[]): Map<number, Set<string>> {
  const byPage = new Map<number, Set<string>>();
  for (const mark of marks) {
    const subtypes = byPage.get(mark.page) ?? new Set<string>();
    if (mark.kind === "highlight") subtypes.add("Highlight");
    if (mark.kind === "note") subtypes.add("FreeText");
    byPage.set(mark.page, subtypes);
  }
  return byPage;
}

async function editorSaveLooksComplete(
  bytes: Uint8Array,
  marks: AnnotationBurn[],
): Promise<boolean> {
  const expected = expectedEditorSubtypes(marks);
  for (const [page, subtypes] of expected) {
    const found = await listPageAnnotationSubtypes(bytes, page);
    for (const name of subtypes) {
      if (!found.includes(name)) return false;
    }
  }
  return true;
}

export async function writeEditorAnnotationsWithPdfLib(
  bytes: ArrayBuffer | Uint8Array,
  marks: AnnotationBurn[],
): Promise<Uint8Array> {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await PDFDocument.load(src.slice(), { ignoreEncryption: true });
  writeNativeAnnotations(doc, marks);
  return doc.save();
}

/**
 * Prefer Mozilla's saveDocument path. If the worker cannot emit annot dicts
 * (headless canvas/font gaps), write the same Highlight / FreeText objects
 * with pdf-lib so export still produces real annotations.
 */
export async function saveEditorAnnotations(
  bytes: ArrayBuffer | Uint8Array,
  marks: AnnotationBurn[],
): Promise<EditorSaveResult> {
  const editorMarks = marks.filter((m) => m.kind === "highlight" || m.kind === "note");
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!editorMarks.length) return { bytes: src.slice(), via: "pdf-lib-dicts" };

  try {
    const saved = await saveWithPdfJs(src, editorMarks);
    if (await editorSaveLooksComplete(saved, editorMarks)) {
      return { bytes: saved, via: "pdfjs-saveDocument" };
    }
  } catch (error) {
    console.error("pdf.js saveDocument failed; writing annotation dicts with pdf-lib", error);
  }

  return {
    bytes: await writeEditorAnnotationsWithPdfLib(src, editorMarks),
    via: "pdf-lib-dicts",
  };
}

export function bytesContainSubtype(bytes: Uint8Array, subtype: string): boolean {
  let raw = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    raw += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return raw.includes(`/Subtype /${subtype}`) || raw.includes(`/Subtype/${subtype}`);
}
