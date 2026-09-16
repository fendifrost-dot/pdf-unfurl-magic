import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

type PromiseWithResolversCtor = PromiseConstructor & {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

describe("Node test runtime (Node 20 + 22)", () => {
  it("exposes Promise.withResolvers so pdfjs can load on Node 20", async () => {
    const ctor = Promise as PromiseWithResolversCtor;
    expect(typeof ctor.withResolvers).toBe("function");
    const { promise, resolve } = ctor.withResolvers!<number>();
    resolve(42);
    await expect(promise).resolves.toBe(42);
  });

  it("can import pdfjs-dist after the withResolvers polyfill", async () => {
    const pdfjs = await import("pdfjs-dist");
    expect(typeof pdfjs.getDocument).toBe("function");
  });

  it("declares engines.node and keeps test scripts portable off Node 22-only flags", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      engines?: { node?: string };
      scripts: Record<string, string>;
    };
    expect(pkg.engines?.node).toMatch(/>=\s*20\b/);
    expect(pkg.scripts["test:scan"]).toMatch(/\btsx\b/);
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(cmd, `${name} must not use --experimental-strip-types`).not.toMatch(
        /experimental-strip-types/,
      );
    }
  });

  it("CI runs the unit suite on Node 20 while engines still allow 20", () => {
    const workflow = readFileSync(join(root, ".github/workflows/test.yml"), "utf8");
    expect(workflow).toMatch(/node:\s*\["20"/);
    expect(workflow).toMatch(/npm test/);
    expect(workflow).toMatch(/test:scan/);
  });
});
