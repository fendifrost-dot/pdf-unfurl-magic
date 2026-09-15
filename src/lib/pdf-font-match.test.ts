import { describe, expect, it } from "vitest";
import { StandardFonts } from "pdf-lib";
import {
  charsMissingFromWinAnsi,
  decodeWinAnsiBytes,
  encodeWinAnsiBytes,
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
});
