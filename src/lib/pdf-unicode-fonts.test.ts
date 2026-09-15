import { describe, expect, it } from "vitest";
import { charsMissingFromWinAnsi } from "./pdf-font-match";
import {
  charsMissingFromBundledFonts,
  loadBundledFontBytes,
  resolveUnicodeFallback,
} from "./pdf-unicode-fonts";

describe("bundled SIL OFL fonts (PRIOR_ART #1)", () => {
  it("loads Liberation Sans and covers Łódź plus invoice punctuation", async () => {
    const bytes = await loadBundledFontBytes("LiberationSans-Regular.ttf");
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const fallback = await resolveUnicodeFallback("Łódź, 2,257.00 — café");
    expect(fallback.ok).toBe(true);
    if (fallback.ok) expect(fallback.face.label).toMatch(/Liberation Sans/);
    expect(await charsMissingFromBundledFonts("Łódź, 2,257.00")).toEqual([]);
  });

  it("still reports CJK as missing so we do not bake in “?”", async () => {
    expect(charsMissingFromWinAnsi("你好")).toEqual(["你", "好"]);
    expect(await charsMissingFromBundledFonts("你好")).toEqual(["你", "好"]);
  });
});
