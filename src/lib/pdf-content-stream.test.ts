import { describe, expect, it } from "vitest";
import {
  collectTextShows,
  encodePdfLiteral,
  extractShownStrings,
  findFuzzySpan,
  hasWhiteCoverRect,
  replaceShowText,
  sameVisibleRun,
  showPaintsVisibleGlyphs,
  shiftShowUserPosition,
  softMatchKey,
  spliceHaystack,
  streamTextMatchesVisual,
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

  it("treats 3 Tr outside BT as still painting glyphs", () => {
    const outside = collectTextShows(tokenizeContentStream("3 Tr BT /F1 10 Tf (Hello) Tj ET"));
    expect(outside[0]?.textRenderingMode).toBe(3);
    expect(outside[0]?.trInTextObject).toBe(false);
    expect(showPaintsVisibleGlyphs(outside[0]!)).toBe(true);

    const inside = collectTextShows(tokenizeContentStream("BT 3 Tr /F1 10 Tf (Hello) Tj ET"));
    expect(inside[0]?.trInTextObject).toBe(true);
    expect(showPaintsVisibleGlyphs(inside[0]!)).toBe(false);
  });

  it("skips inline image data so BI...EI is not mistaken for text", () => {
    const src = "q BI /W 1 /H 1 /CS /RGB ID \x00\x00\x00 EI Q BT /F1 10 Tf (Label) Tj ET";
    const shows = collectTextShows(tokenizeContentStream(src));
    expect(shows.map((s) => s.text)).toEqual(["Label"]);
  });

  it("keeps a thousands comma inside a TJ amount", () => {
    const src = "BT /F2 11 Tf 1 0 0 1 420 500 Tm [(2,) -20 (500.00)] TJ ET";
    const shows = collectTextShows(tokenizeContentStream(src));
    expect(shows[0]?.text).toBe("2,500.00");
  });

  it("treats a large negative TJ kern as a word space, not a missing comma", () => {
    const src = "BT /F1 10 Tf [(Hello) -250 (world)] TJ ET";
    const shows = collectTextShows(tokenizeContentStream(src));
    expect(shows[0]?.text).toBe("Hello world");
  });

  it("decodes Identity-H / UTF-16BE hex so commas survive", () => {
    const src = "BT /F1 10 Tf <0032002C003500300030002E00300030> Tj ET";
    const shows = collectTextShows(tokenizeContentStream(src));
    expect(shows[0]?.text).toBe("2,500.00");
    expect(shows[0]?.bytes.length).toBe(16);
  });
});

describe("statement fragment matching", () => {
  it("treats hyphen spacing as the same run", () => {
    expect(softMatchKey("Debit- Debit")).toBe(softMatchKey("Debit - Debit"));
  });

  it("finds a PDF.js fragment inside a longer POS line", () => {
    const hay = "06-06 POS Debit- Debit Card 6205 06-26 Amazon Mktp Us";
    const span = findFuzzySpan(hay, "06 POS Debit- Debit Card 6205");
    expect(span).toBeTruthy();
    expect(hay.slice(span!.start, span!.end)).toContain("POS Debit- Debit Card 6205");
    expect(spliceHaystack(hay, "06 POS Debit- Debit Card 6205", "06 POS Debit Card 6205")).toBe(
      "06-06 POS Debit Card 6205 06-26 Amazon Mktp Us",
    );
  });

  it("maps a stripped thousands comma back onto 2,500.00", () => {
    expect(findFuzzySpan("2,500.00", "2 500.00")).toEqual({ start: 0, end: 8 });
    expect(spliceHaystack("POS 2,500.00 BILL", "2 500.00", "2,750.00")).toBe("POS 2,750.00 BILL");
  });

  it("treats comma-stripped PDF.js amounts as the same visible run", () => {
    expect(sameVisibleRun("2,500.00", "2 500.00")).toBe(true);
    expect(sameVisibleRun("3DLG 7R", "Paid To")).toBe(false);
    expect(
      streamTextMatchesVisual(
        "06-06 POS Debit- Debit Card 6205 06-26 Amazon",
        "06 POS Debit- Debit Card 6205",
      ),
    ).toBe(true);
    expect(streamTextMatchesVisual("3DLG 7R", "Paid To")).toBe(false);
  });
});

describe("shiftShowUserPosition", () => {
  it("rewrites a dedicated Tm so the show origin moves", () => {
    const src = "BT /F1 11 Tf 1 0 0 1 50 400 Tm (Paid To) Tj ET";
    const tokens = tokenizeContentStream(src);
    const show = collectTextShows(tokens)[0];
    expect(show?.x).toBeCloseTo(50);
    const next = shiftShowUserPosition(tokens, show!, 120, 400);
    const moved = collectTextShows(next)[0];
    expect(moved?.text).toBe("Paid To");
    expect(moved?.x).toBeCloseTo(120);
    expect(extractShownStrings(next)).toEqual(["Paid To"]);
  });

  it("does not move a neighbour that has its own Tm", () => {
    const src = "BT /F1 11 Tf 1 0 0 1 50 400 Tm (Paid To) Tj 1 0 0 1 400 400 Tm (500.00) Tj ET";
    const tokens = tokenizeContentStream(src);
    const shows = collectTextShows(tokens);
    expect(shows).toHaveLength(2);
    const next = shiftShowUserPosition(tokens, shows[0]!, 90, 400);
    const after = collectTextShows(next);
    expect(after[0]?.x).toBeCloseTo(90);
    expect(after[1]?.x).toBeCloseTo(400);
    expect(after.map((item) => item.text)).toEqual(["Paid To", "500.00"]);
  });
});
