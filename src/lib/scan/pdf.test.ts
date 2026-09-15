import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { bytesToLatin1 } from "../pdf-content-stream";
import { listPageShownText } from "../pdf-text-edit";
import { setInvisibleOcrTextMode } from "./pdf";

describe("invisible OCR text layer", () => {
  it("writes text rendering mode 3 instead of opacity:0", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    setInvisibleOcrTextMode(page);
    page.drawText("SCAN FIXTURE", {
      x: 20,
      y: 100,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    const bytes = await doc.save({ useObjectStreams: false });
    const raw = bytesToLatin1(bytes);
    expect(raw).toMatch(/\b3\s+Tr\b/);
    expect(raw).not.toMatch(/\/ca\s+0/);
    const shown = await listPageShownText(bytes.slice().buffer as ArrayBuffer, 1);
    expect(shown).toContain("SCAN FIXTURE");
  });
});
