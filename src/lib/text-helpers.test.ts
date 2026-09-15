import { describe, expect, it } from "vitest";
import { cleanCopy } from "./text-helpers";

describe("cleanCopy", () => {
  it("does not strip or space-break thousands commas in amounts", () => {
    expect(cleanCopy("2,500.00")).toBe("2,500.00");
    expect(cleanCopy("Total due 1,987.00")).toBe("Total due 1,987.00");
  });

  it("still puts a space after a list comma in prose", () => {
    expect(cleanCopy("oak,birch,pine")).toBe("oak, birch, pine");
  });

  it("keeps currency and hyphen-minus", () => {
    expect(cleanCopy("EUR €40.00 on 2026-09-14")).toBe("EUR €40.00 on 2026-09-14");
  });
});
