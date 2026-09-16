import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { applyPageMarks } from "./pdf-marks";
import { listPageShownText } from "./pdf-text-edit";
import {
  PASSWORD_OPEN_FIXTURE_PASSWORD,
  PASSWORD_OPEN_MARKER,
  buildPasswordOpenPdf,
} from "./pdf-password-fixture";
import { PdfEncryptedMutationError } from "./pdf-io";
import {
  COVER_BOX_LABEL,
  PERMANENT_REDACT_FIND_LABEL,
  PERMANENT_REDACT_LABEL,
  REDACT_SEARCH_TITLE,
  eraseMarksFromHits,
  findHitsInPageItems,
  isRedactSearchMark,
  markListLabel,
  pdfjsItemsFromTextContent,
  searchDocumentText,
} from "./pdf-redact-search";
import { estimateWidth } from "./text-helpers";

function fixture(name: string): Uint8Array {
  const buf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../fixtures", name));
  return new Uint8Array(buf);
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

async function withProxy<T>(
  bytes: Uint8Array,
  fn: (proxy: Awaited<ReturnType<typeof getDocument>["promise"]>) => Promise<T>,
  password = "",
): Promise<T> {
  const proxy = await getDocument({ data: bytes.slice(), password }).promise;
  try {
    return await fn(proxy);
  } finally {
    await proxy.destroy();
  }
}

async function pdfJsText(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  return withProxy(bytes, async (proxy) => {
    const page = await proxy.getPage(pageNumber);
    const content = await page.getTextContent();
    return content.items.map((item) => ("str" in item ? String(item.str) : "")).join(" ");
  });
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
    const dir = mkdtempSync(join(tmpdir(), "pdf-relief-redact-search-"));
    const pdfPath = join(dir, "in.pdf");
    writeFileSync(pdfPath, bytes);
    return execFileSync("pdftotext", ["-raw", pdfPath, "-"], { encoding: "utf8" });
  } catch {
    return null;
  }
}

describe("redaction search labels", () => {
  it("never labels a cover box as a redaction search result", () => {
    expect(COVER_BOX_LABEL.toLowerCase()).not.toMatch(/redaction search/);
    expect(REDACT_SEARCH_TITLE.toLowerCase()).not.toMatch(/cover box/);
    expect(markListLabel({ kind: "redact" })).toBe("cover box");
    expect(markListLabel({ kind: "redact", searchQuery: "SECRET" })).toBe("cover box");
    expect(isRedactSearchMark({ kind: "redact", searchQuery: "SECRET" })).toBe(false);
    expect(markListLabel({ kind: "erase" })).toBe(PERMANENT_REDACT_LABEL);
    expect(markListLabel({ kind: "erase", searchQuery: "SECRET" })).toBe(PERMANENT_REDACT_FIND_LABEL);
  });

  it("turns hits into erase marks, never cover boxes", () => {
    const marks = eraseMarksFromHits([
      {
        id: "p1-0-6-0",
        page: 1,
        query: "SECRET",
        matched: "SECRET",
        snippet: "SECRET",
        rects: [
          { x: 40, y: 350, width: 80, height: 22 },
          { x: 40, y: 200, width: 80, height: 22 },
        ],
      },
    ]);
    expect(marks.every((m) => m.kind === "erase")).toBe(true);
    expect(marks.some((m) => m.kind === "redact")).toBe(false);
    expect(marks.every((m) => m.searchQuery === "SECRET")).toBe(true);
    expect(marks).toHaveLength(2);
    expect(marks.every(isRedactSearchMark)).toBe(true);
  });
});

describe("findHitsInPageItems", () => {
  it("finds a case-insensitive substring and boxes only that run", () => {
    const items = [
      { str: "KEEP ", x: 40, y: 420, width: 50, height: 18 },
      { str: "SECRET", x: 40, y: 360, width: 72, height: 18 },
      { str: "VISIBLE", x: 40, y: 300, width: 70, height: 18 },
    ];
    const hits = findHitsInPageItems(items, "secret", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matched.toLowerCase()).toBe("secret");
    expect(hits[0]?.page).toBe(1);
    const rect = hits[0]!.rects[0]!;
    expect(rect.y).toBeGreaterThan(330);
    expect(rect.y + rect.height).toBeLessThan(410);
    expect(rect.x).toBeLessThan(45);
  });

  it("joins adjacent items so SECRET spanning two Tj operators still matches", () => {
    const items = [
      { str: "SE", x: 40, y: 360, width: 24, height: 18 },
      { str: "CRET", x: 64, y: 360, width: 48, height: 18 },
    ];
    const hits = findHitsInPageItems(items, "SECRET", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matched).toBe("SECRET");
    expect(hits[0]?.rects[0]?.width).toBeGreaterThan(40);
  });

  it("returns nothing for a blank query", () => {
    expect(findHitsInPageItems([{ str: "SECRET", x: 0, y: 0, width: 10, height: 10 }], "  ", 1)).toEqual(
      [],
    );
  });

  it("reads transform matrices the way pdf.js getTextContent provides them", () => {
    const items = pdfjsItemsFromTextContent([
      { str: "SECRET", transform: [18, 0, 0, 18, 40, 360], width: 72, height: 18 },
    ]);
    expect(items[0]).toMatchObject({ str: "SECRET", x: 40, y: 360, width: 72, height: 18 });
    expect(findHitsInPageItems(items, "SECRET", 1)).toHaveLength(1);
  });

  it("grows a too-small reported width up to the estimated glyph run", () => {
    // pdf.js under-reports SECRET (20pt for a ~68pt run). The erase box would
    // otherwise stop short and leave the tail extractable.
    const estimated = estimateWidth("SECRET", 18);
    const items = pdfjsItemsFromTextContent([
      { str: "SECRET", transform: [18, 0, 0, 18, 40, 360], width: 20, height: 18 },
    ]);
    expect(items[0]?.width).toBeGreaterThanOrEqual(estimated);
    expect(items[0]?.width).toBeGreaterThan(20);
  });

  it("keeps an accurate reported width instead of shrinking it to the estimate", () => {
    // A generous report (wider than our heuristic) must not be clipped.
    const generous = estimateWidth("SECRET", 18) + 25;
    const items = pdfjsItemsFromTextContent([
      { str: "SECRET", transform: [18, 0, 0, 18, 40, 360], width: generous, height: 18 },
    ]);
    expect(items[0]?.width).toBe(generous);
  });

  it("covers the full run when pdf.js reports the width too small", () => {
    // End to end from the raw pdf.js item: the erase rect must span roughly the
    // estimated width so every glyph of the match lands inside the hole.
    const items = pdfjsItemsFromTextContent([
      { str: "SECRET", transform: [18, 0, 0, 18, 40, 360], width: 20, height: 18 },
    ]);
    const hits = findHitsInPageItems(items, "SECRET", 1);
    expect(hits).toHaveLength(1);
    const rect = hits[0]?.rects[0];
    expect(rect?.width).toBeGreaterThanOrEqual(estimateWidth("SECRET", 18));
  });
});

describe("searchDocumentText + permanent redact", () => {
  it("finds SECRET on the committed fixture and erases it on Save As", async () => {
    const bytes = fixture("redact-secret.pdf");
    const hits = await withProxy(bytes, (proxy) => searchDocumentText(proxy, "secret"));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.every((hit) => hit.page === 1)).toBe(true);
    expect(hits[0]?.matched.toLowerCase()).toBe("secret");

    const marks = eraseMarksFromHits(hits);
    expect(marks.every((m) => m.kind === "erase")).toBe(true);
    expect(marks.some((m) => m.kind === "redact")).toBe(false);

    const erased = await applyPageMarks(bytes, marks);
    const shown = (await listPageShownText(asBuffer(erased), 1)).join(" ");
    expect(shown).not.toMatch(/SECRET/i);
    expect(shown).toMatch(/KEEP/);
    expect(shown).toMatch(/VISIBLE/);
    expect(await pdfJsText(erased)).not.toMatch(/SECRET/i);
    expect(await pdfJsText(erased)).toMatch(/KEEP/);
    expect(await pdfJsText(erased)).toMatch(/VISIBLE/);

    const poppler = pdftotextIfAvailable(erased);
    if (poppler !== null) {
      expect(poppler).not.toMatch(/SECRET/i);
      expect(poppler).toMatch(/KEEP/);
      expect(poppler).toMatch(/VISIBLE/);
    }
  });

  it("redacts only the matched page marker on multi-page.pdf", async () => {
    const bytes = fixture("multi-page.pdf");
    const hits = await withProxy(bytes, (proxy) => searchDocumentText(proxy, "PAGE_MARKER_2"));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.page).toBe(2);

    const erased = await applyPageMarks(bytes, eraseMarksFromHits(hits));
    expect((await listPageShownText(asBuffer(erased), 1)).join(" ")).toMatch(/PAGE_MARKER_1/);
    expect((await listPageShownText(asBuffer(erased), 2)).join(" ")).not.toMatch(/PAGE_MARKER_2/);
    expect((await listPageShownText(asBuffer(erased), 3)).join(" ")).toMatch(/PAGE_MARKER_3/);
  });

  it("rewrites a mixed line so TOKEN and END survive", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("TOKEN SECRET END", { x: 20, y: 100, size: 14, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();
    const hits = await withProxy(bytes, (proxy) => searchDocumentText(proxy, "SECRET"));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const erased = await applyPageMarks(bytes, eraseMarksFromHits(hits));
    const blob = (await listPageShownText(asBuffer(erased), 1)).join(" ");
    expect(blob).not.toMatch(/SECRET/);
    expect(blob).toMatch(/TOKEN/);
    expect(blob).toMatch(/END/);
  });

  it("searches an unlocked encrypted file but refuses to rewrite it", async () => {
    const bytes = buildPasswordOpenPdf();
    const hits = await withProxy(
      bytes,
      (proxy) => searchDocumentText(proxy, PASSWORD_OPEN_MARKER),
      PASSWORD_OPEN_FIXTURE_PASSWORD,
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.matched).toContain("PASSWORD_OPEN");
    await expect(applyPageMarks(bytes, eraseMarksFromHits(hits))).rejects.toBeInstanceOf(
      PdfEncryptedMutationError,
    );
  });
});
