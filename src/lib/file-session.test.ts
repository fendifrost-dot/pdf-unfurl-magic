import { describe, expect, it } from "vitest";
import { exportFileName } from "./pdf-marks";
import {
  APPLY_SESSION_HINT,
  CLOSE_DOCUMENT_LABEL,
  EXPORT_ALIAS_LABEL,
  OPEN_ANOTHER_PDF_LABEL,
  SAVE_AS_HINT,
  SAVE_AS_LABEL,
  ensureNewPdfName,
  isSamePdfBaseName,
} from "./file-session";

describe("Save As / Close document copy", () => {
  it("uses Save As as the write action and keeps Export as an alias", () => {
    expect(SAVE_AS_LABEL).toBe("Save As…");
    expect(EXPORT_ALIAS_LABEL).toBe("Export");
    expect(CLOSE_DOCUMENT_LABEL).toMatch(/close document/i);
    expect(OPEN_ANOTHER_PDF_LABEL).toMatch(/open another pdf/i);
    expect(SAVE_AS_HINT).toMatch(/never overwrites/i);
    expect(APPLY_SESSION_HINT).toMatch(/preview only/i);
    expect(APPLY_SESSION_HINT).toMatch(/save as/i);
  });

  it("never suggests the uploaded source filename", () => {
    expect(ensureNewPdfName("statement.pdf")).toBe("statement-edited.pdf");
    expect(ensureNewPdfName("statement.pdf", "statement.pdf")).toBe("statement-edited.pdf");
    expect(ensureNewPdfName("statement.PDF", "statement")).toBe("statement-edited.pdf");
    expect(ensureNewPdfName("memo.pdf", "memo-edited.pdf")).toBe("memo-edited.pdf");
    expect(ensureNewPdfName("memo.pdf", "memo-marked.pdf")).toBe("memo-marked.pdf");
    expect(ensureNewPdfName("memo.pdf", "memo-redacted.pdf")).toBe("memo-redacted.pdf");
    expect(ensureNewPdfName("memo.pdf", "memo-rotated.pdf")).toBe("memo-rotated.pdf");
    expect(ensureNewPdfName("multi-page.pdf", "multi-page-reordered.pdf")).toBe(
      "multi-page-reordered.pdf",
    );
    expect(ensureNewPdfName("multi-page.pdf", "multi-page-extract.pdf")).toBe(
      "multi-page-extract.pdf",
    );
    expect(ensureNewPdfName("multi-page.pdf", "multi-page-pages.pdf")).toBe("multi-page-pages.pdf");
    expect(isSamePdfBaseName("June_statement.pdf", "June_statement.pdf")).toBe(true);
    expect(isSamePdfBaseName("June_statement.pdf", "June_statement-edited.pdf")).toBe(false);
  });

  it("exportFileName always differs from the source basename", () => {
    expect(exportFileName("statement", false, [])).toBe("statement-edited.pdf");
    expect(exportFileName("statement", true, [])).toBe("statement-edited.pdf");
    expect(ensureNewPdfName("statement.pdf", exportFileName("statement", false, []))).toBe(
      "statement-edited.pdf",
    );
    expect(exportFileName("statement", false, [], false, true)).toBe("statement-rotated.pdf");
    expect(
      ensureNewPdfName("statement.pdf", exportFileName("statement", false, [], false, true)),
    ).toBe("statement-rotated.pdf");
  });
});
