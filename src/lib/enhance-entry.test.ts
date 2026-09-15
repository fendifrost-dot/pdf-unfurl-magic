import { describe, expect, it } from "vitest";
import {
  ENHANCE_CHIP_LABEL,
  ENHANCE_TRIGGER_LABEL,
  enhanceEntryCopy,
  shouldAutoExpandEnhance,
} from "./enhance-entry";

describe("enhance entry", () => {
  it("stays collapsed for native text pages with no OCR session", () => {
    expect(shouldAutoExpandEnhance({ looksScanned: false, ocrLineCount: 0 })).toBe(false);
  });

  it("auto-expands when auto-detect says scanned", () => {
    expect(shouldAutoExpandEnhance({ looksScanned: true, ocrLineCount: 0 })).toBe(true);
  });

  it("auto-expands after OCR lines exist even if detect said native", () => {
    expect(shouldAutoExpandEnhance({ looksScanned: false, ocrLineCount: 12 })).toBe(true);
  });

  it("tells native-PDF users the control is optional and not auto-run", () => {
    const copy = enhanceEntryCopy(false);
    expect(copy.title.toLowerCase()).toContain("optional");
    expect(copy.body.toLowerCase()).toContain("optional");
    expect(copy.body.toLowerCase()).toMatch(/scan|blurry/);
    expect(copy.body.toLowerCase()).toMatch(/ignore|clean digital/);
    expect(copy.body.toLowerCase()).toMatch(/nothing runs until/);
  });

  it("keeps scanned copy distinct from the optional native hint", () => {
    const copy = enhanceEntryCopy(true);
    expect(copy.title).toMatch(/looks scanned/i);
    expect(copy.body.toLowerCase()).not.toContain("optional");
  });

  it("exposes stable toolbar and panel labels", () => {
    expect(ENHANCE_CHIP_LABEL).toBe("Enhance");
    expect(ENHANCE_TRIGGER_LABEL).toBe("Enhance & OCR this page");
  });
});
