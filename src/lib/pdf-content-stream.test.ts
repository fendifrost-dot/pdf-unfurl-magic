import { describe, expect, it } from "vitest";
import {
  collectTextShows,
  encodePdfLiteral,
  extractShownStrings,
  hasWhiteCoverRect,
  replaceShowText,
  tokenizeContentStream,
  tokensToBytes,
} from "./pdf-content-stream";

describe("content stream tokenizer", () => {
  it("round-trips a pdf-lib style text object including hex strings", () => {
    const src = "BT\n/F1 11 Tf\n0.1 0.11 0.13 rg\n1 0 0 1 56 770 Tm\n<4E6F72746867617465> Tj\nET\n";
    const tokens = tokenizeContentStream(src);
    expect(tokensToBytes(tokens)).toEqual(new TextEncoder().encode(src).subarray(0, src.length));
    const shows = collectTextShows(tokens);
    expect(shows).toHaveLength(1);
    expect(shows[0]?.text).toBe("Northgate");
    expect(shows[0]?.fontName).toBe("F1");
    expect(shows[0]?.x).toBeCloseTo(56);
    expect(shows[0]?.y).toBeCloseTo(770);
  });

  it("reads TJ arrays and literal escapes", () => {
    const src = "BT /F2 10 Tf 0 0 Td [(Hel\\(lo\\)) -20 (World)] TJ ET";
    const shows = collectTextShows(tokenizeContentStream(src));
    expect(shows[0]?.text).toBe("Hel(lo)World");
  });

  it("replaces a show in place without adding a white rectangle", () => {
    const src = "BT /F2 11 Tf 1 0 0 1 490 500 Tm (1,987.00) Tj ET";
    let tokens = tokenizeContentStream(src);
    const show = collectTextShows(tokens)[0];
    expect(show).toBeTruthy();
    tokens = replaceShowText(tokens, show!, "2,257.00");
    expect(extractShownStrings(tokens)).toEqual(["2,257.00"]);
    expect(extractShownStrings(tokens)).not.toContain("1,987.00");
    expect(hasWhiteCoverRect(tokens, { x: 490, y: 500, width: 50, height: 14 })).toBe(false);
  });

  it("skips inline image data so BI...EI is not mistaken for text", () => {
    const src = "q BI /W 1 /H 1 /CS /RGB ID \x00\x00\x00 EI Q BT /F1 10 Tf (Label) Tj ET";
    const shows = collectTextShows(tokenizeContentStream(src));
    expect(shows.map((s) => s.text)).toEqual(["Label"]);
  });
});
