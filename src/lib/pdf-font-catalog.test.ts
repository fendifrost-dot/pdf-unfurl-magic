import { describe, expect, it } from "vitest";
import { StandardFonts } from "pdf-lib";
import { catalogEmbeddedFonts, mergeFontCatalog } from "./pdf-font-catalog";
import { matchFont } from "./pdf-font-match";

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
  });

  it("offers Helvetica as a Standard 14 stand-in", () => {
    const catalog = mergeFontCatalog({
      embedded: [],
      match: matchFont({ fontFamily: "SomeCustomDisplay" }),
    });
    expect(catalog.some((item) => item.standard === StandardFonts.Helvetica)).toBe(true);
  });
});
