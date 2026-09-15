import { describe, expect, it } from "vitest";
import { StandardFonts } from "pdf-lib";
import {
  catalogEmbeddedFonts,
  defaultFontChoiceId,
  fontFaceStem,
  mergeFontCatalog,
  suggestClosestFont,
  type EmbeddedFontInfo,
} from "./pdf-font-catalog";
import { matchFont } from "./pdf-font-match";

function juneStatementFonts(): EmbeddedFontInfo[] {
  return [
    {
      key: "C2_0",
      baseFont: "CWCINO+HelveticaNeueWorld-55Roman",
      encoding: "Identity-H",
      subset: true,
      standard: false,
      cid: true,
    },
    {
      key: "C2_1",
      baseFont: "Helvetica",
      encoding: "Identity-H",
      subset: true,
      standard: false,
      cid: true,
    },
    {
      key: "C2_2",
      baseFont: "Helvetica-Bold",
      encoding: "Identity-H",
      subset: true,
      standard: false,
      cid: true,
    },
    {
      key: "C2_3",
      baseFont: "HelveticaNeueWorld-75Bold",
      encoding: "Identity-H",
      subset: true,
      standard: false,
      cid: true,
    },
  ];
}

const juneLine =
  "06-09 Paid To - Mercury Card Fbt Payment Chk 9140844-08-26 Sp Bullymax. Com Shop.Bullymax PA";

describe("font catalog", () => {
  it("lists embedded fonts first and marks symbol fonts unsafe", () => {
    const catalog = mergeFontCatalog({
      embedded: [
        {
          key: "F2",
          baseFont: "Helvetica-Bold",
          encoding: "WinAnsiEncoding",
          subset: false,
          standard: true,
          cid: false,
        },
        {
          key: "F3",
          baseFont: "ZapfDingbats",
          encoding: "",
          subset: false,
          standard: false,
          cid: false,
        },
      ],
      selectedKey: "F2",
      originalText: "2,500.00",
      match: matchFont({ baseFont: "Helvetica-Bold" }),
    });
    expect(catalog[0]?.id).toBe("embedded:F2");
    expect(catalog[0]?.safety).toBe("safe");
    const dingbat = catalog.find((item) => item.resourceKey === "F3");
    expect(dingbat?.safety).toBe("unsafe");
    expect(catalog.some((item) => item.source === "standard")).toBe(true);
  });

  it("does not invent a Creative Cloud download option", () => {
    const embedded = catalogEmbeddedFonts(
      [
        {
          key: "F1",
          baseFont: "ABCDEF+MyriadPro-Regular",
          encoding: "Identity-H",
          subset: true,
          standard: false,
          cid: true,
        },
      ],
      "F1",
      "2,500.00",
    );
    expect(embedded[0]?.label).toBe("MyriadPro-Regular");
    expect(embedded[0]?.reason).not.toMatch(/Creative Cloud|download/i);
    expect(embedded[0]?.reason).toMatch(/subset/i);
    expect(embedded[0]?.reason).toMatch(/Liberation\/Noto/);
    expect(embedded[0]?.reason).toMatch(/no Adobe Fonts purchase required/i);
  });

  it("offers Helvetica as a Standard 14 stand-in", () => {
    const catalog = mergeFontCatalog({
      embedded: [],
      match: matchFont({ fontFamily: "SomeCustomDisplay" }),
    });
    expect(catalog.some((item) => item.standard === StandardFonts.Helvetica)).toBe(true);
    expect(catalog.some((item) => item.source === "bundled")).toBe(true);
  });
});

describe("closest font suggestion (Acrobat-style)", () => {
  it("maps HelveticaNeueWorld-55Roman and 55R to the same stem", () => {
    expect(fontFaceStem("HelveticaNeueWorld-55Roman")).toBe("helveticaneueworld");
    expect(fontFaceStem("CWCINO+HelveticaNeueWorld-55R")).toBe("helveticaneueworld");
    expect(fontFaceStem("Helvetica")).not.toBe(fontFaceStem("HelveticaNeueWorld-55Roman"));
  });

  it("auto-selects June CID HelveticaNeueWorld over Liberation and Identity-H Helvetica", () => {
    const catalog = mergeFontCatalog({
      embedded: juneStatementFonts(),
      selectedKey: "C2_0",
      originalText: juneLine,
      match: matchFont({
        baseFont: "HelveticaNeueWorld-55Roman",
        fontName: "HelveticaNeueWorld-55Roman",
        fontFamily: "sans-serif",
      }),
    });
    expect(catalog.some((item) => item.id === "bundled:liberation-sans")).toBe(true);
    expect(catalog.filter((item) => /helvetica/i.test(item.label)).length).toBeGreaterThan(3);

    const suggestion = suggestClosestFont(catalog, {
      selectedKey: "C2_0",
      fontName: "HelveticaNeueWorld-55Roman",
      fontFamily: "sans-serif",
      baseFont: "CWCINO+HelveticaNeueWorld-55Roman",
      draft: juneLine,
      originalText: juneLine,
    });
    expect(suggestion?.id).toBe("embedded:C2_0");
    expect(suggestion?.rank).toBe("document");
    expect(suggestion?.font.label).toMatch(/HelveticaNeueWorld-55Roman/);
    expect(suggestion?.reason).toMatch(/^Closest match: HelveticaNeueWorld-55Roman/);
    expect(suggestion?.reason).toMatch(/this page’s own face/);
    expect(suggestion?.reason).not.toMatch(/Liberation/);

    expect(
      defaultFontChoiceId(catalog, "C2_0", true, {
        fontName: "HelveticaNeueWorld-55Roman",
        fontFamily: "sans-serif",
        baseFont: "HelveticaNeueWorld-55Roman",
        draft: juneLine,
        originalText: juneLine,
      }),
    ).toBe("embedded:C2_0");
  });

  it("still prefers HelveticaNeueWorld-55R when PDF.js only reports sans-serif", () => {
    const catalog = mergeFontCatalog({
      embedded: [
        {
          key: "F1",
          baseFont: "CWCINO+HelveticaNeueWorld-55R",
          encoding: "Identity-H",
          subset: true,
          standard: false,
          cid: true,
        },
        ...juneStatementFonts().slice(1),
      ],
      selectedKey: "F1",
      originalText: "Paid To",
      match: matchFont({ baseFont: "HelveticaNeueWorld-55R" }),
    });
    const suggestion = suggestClosestFont(catalog, {
      selectedKey: "F1",
      fontFamily: "sans-serif",
      baseFont: "HelveticaNeueWorld-55R",
      draft: "Paid To",
      originalText: "Paid To",
    });
    expect(suggestion?.id).toBe("embedded:F1");
    expect(suggestion?.reason).toMatch(/Closest match: HelveticaNeueWorld-55R/);
  });

  it("matches HelveticaNeueWorld-55Roman to a 55R embed without a resource key", () => {
    const catalog = mergeFontCatalog({
      embedded: [
        {
          key: "F9",
          baseFont: "HelveticaNeueWorld-55R",
          encoding: "Identity-H",
          subset: true,
          standard: false,
          cid: true,
        },
        {
          key: "F2",
          baseFont: "Helvetica",
          encoding: "Identity-H",
          subset: true,
          standard: false,
          cid: true,
        },
      ],
      originalText: juneLine,
      match: matchFont({ fontName: "HelveticaNeueWorld-55Roman" }),
    });
    const suggestion = suggestClosestFont(catalog, {
      fontName: "HelveticaNeueWorld-55Roman",
      fontFamily: "sans-serif",
      draft: juneLine,
      originalText: juneLine,
    });
    expect(suggestion?.id).toBe("embedded:F9");
    expect(suggestion?.font.label).toBe("HelveticaNeueWorld-55R");
  });

  it("falls back to a system metric twin when the document face is missing", () => {
    const catalog = mergeFontCatalog({
      embedded: [],
      match: matchFont({ fontName: "HelveticaNeueWorld-55Roman" }),
      system: [
        {
          family: "Helvetica Neue",
          fullName: "Helvetica Neue",
          postscriptName: "HelveticaNeue",
          style: "Regular",
          blob: async () => new Blob(),
        },
      ],
    });
    const suggestion = suggestClosestFont(catalog, {
      fontName: "HelveticaNeueWorld-55Roman",
      draft: juneLine,
      originalText: juneLine,
    });
    expect(suggestion?.id).toBe("system:HelveticaNeue");
    expect(suggestion?.rank).toBe("system");
    expect(suggestion?.reason).toMatch(/^Closest match: Helvetica Neue/);
    expect(suggestion?.reason).toMatch(/metric twin/);
  });

  it("uses bundled Liberation only when the original WinAnsi face cannot encode the draft", () => {
    const catalog = mergeFontCatalog({
      embedded: [
        {
          key: "F2",
          baseFont: "Helvetica-Bold",
          encoding: "WinAnsiEncoding",
          subset: false,
          standard: true,
          cid: false,
        },
      ],
      selectedKey: "F2",
      originalText: "Northgate Joinery",
      match: matchFont({ baseFont: "Helvetica-Bold" }),
    });
    const suggestion = suggestClosestFont(catalog, {
      selectedKey: "F2",
      baseFont: "Helvetica-Bold",
      draft: "Łódź, 2,257.00",
      originalText: "Northgate Joinery",
    });
    expect(suggestion?.id).toBe("bundled:liberation-sans");
    expect(suggestion?.rank).toBe("bundled");
    expect(suggestion?.reason).toMatch(/^Closest match: Liberation Sans/);
    expect(suggestion?.reason).toMatch(/cannot encode this draft/);
  });
});
