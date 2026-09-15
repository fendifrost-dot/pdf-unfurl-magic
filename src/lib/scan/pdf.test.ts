import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { bytesToLatin1 } from "../pdf-content-stream";
import { decodePageContentRaw, listPageShownText } from "../pdf-text-edit";
import { drawOcrGlyphs, setInvisibleOcrTextMode } from "./pdf";

describe("invisible OCR text layer", () => {
  it("writes 3 Tr inside BT so glyphs stay hidden", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    drawOcrGlyphs(page, font, "SCAN FIXTURE", {
      x: 20,
      y: 100,
      size: 12,
      invisible: true,
    });
    const bytes = await doc.save({ useObjectStreams: false });
    const raw = await decodePageContentRaw(bytes.slice().buffer as ArrayBuffer, 1);
    expect(raw).toMatch(/\bBT\b[\s\S]*?\b3\s+Tr\b[\s\S]*?\bTj\b[\s\S]*?\bET\b/);
    expect(bytesToLatin1(bytes)).not.toMatch(/\/ca\s+0/);
    const shown = await listPageShownText(bytes.slice().buffer as ArrayBuffer, 1);
    expect(shown).toContain("SCAN FIXTURE");
  });

  it("pdf-lib drawText after a leading 3 Tr leaves Tr outside BT", async () => {
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
    const raw = await decodePageContentRaw(bytes.slice().buffer as ArrayBuffer, 1);
    expect(raw).toMatch(/\b3\s+Tr\b/);
    expect(raw).not.toMatch(/\bBT\b[\s\S]*?\b3\s+Tr\b[\s\S]*?\bTj\b/);
  });
});
