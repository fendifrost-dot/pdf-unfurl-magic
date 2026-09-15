import { describe, expect, it } from "vitest";
import { StandardFonts } from "pdf-lib";
import {
  charsMissingFromWinAnsi,
  decodeShowBytes,
  decodeWinAnsiBytes,
  describeFontMatch,
  encodeWinAnsiBytes,
  foldPdfPunctuation,
  matchFont,
} from "./pdf-font-match";

describe("matchFont", () => {
  it("maps Helvetica-Bold in the file to the same Standard 14 font", () => {
    const match = matchFont({ baseFont: "Helvetica-Bold" });
    expect(match.standard).toBe(StandardFonts.HelveticaBold);
    expect(match.kind).toBe("embedded-standard");
    expect(match.label).toBe("Helvetica-Bold");
  });

  it("maps Times and Courier families without requiring Creative Cloud names", () => {
    expect(matchFont({ baseFont: "Times-Roman" }).standard).toBe(StandardFonts.TimesRoman);
    expect(matchFont({ fontFamily: "Courier New, monospace" }).standard).toBe(
      StandardFonts.Courier,
    );
    expect(matchFont({ fontName: "Arial-BoldMT" }).standard).toBe(StandardFonts.HelveticaBold);
    expect(matchFont({ baseFont: "ABCDEF+TimesNewRomanPS-BoldMT" }).standard).toBe(
      StandardFonts.TimesRomanBold,
    );
  });

  it("falls back to Helvetica for an unknown family instead of inventing a cloud font", () => {
    const match = matchFont({ fontFamily: "SomeCustomDisplay" });
    expect(match.standard).toBe(StandardFonts.Helvetica);
    expect(match.kind).toBe("standard-fallback");
  });
});

describe("WinAnsi coverage", () => {
  it("accepts invoice figures and the euro sign", () => {
    expect(charsMissingFromWinAnsi("2,257.00")).toEqual([]);
    expect(charsMissingFromWinAnsi("Total due — €40")).toEqual([]);
  });

  it("flags characters that would become .notdef / question marks", () => {
    expect(charsMissingFromWinAnsi("你好")).toEqual(["你", "好"]);
    expect(charsMissingFromWinAnsi("OK ✓")).toEqual(["✓"]);
  });

  it("round-trips WinAnsi bytes including an em dash", () => {
    const text = "Quote 2026-118 — kitchen";
    expect(decodeWinAnsiBytes(encodeWinAnsiBytes(text))).toBe(text);
  });

  it("folds unicode minus to ASCII so amounts stay encodable", () => {
    expect(foldPdfPunctuation("−40.00")).toBe("-40.00");
    expect(charsMissingFromWinAnsi("Total − €40")).toEqual([]);
  });

  it("decodes two-byte Identity-H Latin including a comma", () => {
    const bytes = Uint8Array.from([
      0x00, 0x32, 0x00, 0x2c, 0x00, 0x35, 0x00, 0x30, 0x00, 0x30, 0x00, 0x2e, 0x00, 0x30, 0x00,
      0x30,
    ]);
    expect(decodeShowBytes(bytes)).toBe("2,500.00");
  });

  it("describes HelveticaNeueWorld without requiring an Adobe Fonts purchase", () => {
    const match = matchFont({
      baseFont: "HelveticaNeueWorld-55R",
      fontName: "CWCINO+HelveticaNeueWorld-55R",
    });
    expect(match.kind).toBe("standard-same-family");
    expect(match.standard).toBe(StandardFonts.Helvetica);
    const message = describeFontMatch(match, []);
    expect(message).toMatch(/Liberation\/Noto|stand-in/i);
    expect(message).not.toMatch(/must buy|Creative Cloud font needed$/i);
    expect(describeFontMatch(match, [], "Liberation Sans")).toMatch(/PRIOR_ART #1/);
    expect(describeFontMatch(match, ["你"])).toMatch(/would write “\?”/);
  });
});
