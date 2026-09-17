/**
 * Build provenance: the packed app must be able to name the commit it was built
 * from, and must still build and run when git metadata is unavailable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = require(path.join(root, "desktop/gen-build-info.cjs"));

test("buildInfo() returns the expected shape", () => {
  const info = mod.buildInfo();
  for (const key of ["sha", "branch", "dirty", "builtAt"]) {
    assert.ok(key in info, `missing ${key}`);
  }
  assert.doesNotThrow(() => new Date(info.builtAt).toISOString());
});

test("dirty distinguishes a clean tree from unknown", () => {
  // `git status --porcelain` prints nothing on a clean tree. Collapsing that
  // empty output to null reported a clean build as "unknown" — the packed app
  // at 345a0ff shipped `"dirty": null` from a clean checkout.
  const info = mod.buildInfo();
  if (info.sha !== null) {
    assert.notEqual(
      info.dirty,
      null,
      "git worked, so dirty must be true or false — never null",
    );
    assert.equal(typeof info.dirty, "boolean");
  }
});

test("write() emits parseable JSON at the packed location", () => {
  const { out, info } = mod.write();
  assert.equal(out, mod.OUT_PATH);
  const onDisk = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepEqual(onDisk, info);
});

test("read() round-trips what write() produced", () => {
  const { info } = mod.write();
  assert.deepEqual(mod.read(), info);
});

test("read() never throws on a missing or corrupt file", () => {
  const saved = fs.existsSync(mod.OUT_PATH)
    ? fs.readFileSync(mod.OUT_PATH, "utf8")
    : null;
  try {
    fs.writeFileSync(mod.OUT_PATH, "{ not json");
    assert.deepEqual(mod.read(), {
      sha: null,
      branch: null,
      dirty: null,
      builtAt: null,
    });

    fs.rmSync(mod.OUT_PATH, { force: true });
    assert.deepEqual(mod.read(), {
      sha: null,
      branch: null,
      dirty: null,
      builtAt: null,
    });
  } finally {
    if (saved !== null) fs.writeFileSync(mod.OUT_PATH, saved);
    else mod.write();
  }
});

test("describe() degrades gracefully instead of claiming a build", () => {
  assert.match(mod.describe(null), /unknown/);
  assert.match(mod.describe({ sha: null }), /unknown/);
  assert.match(
    mod.describe({ sha: "abc1234", branch: "main", dirty: false, builtAt: null }),
    /abc1234/,
  );
  assert.match(
    mod.describe({ sha: "abc1234", branch: "main", dirty: true, builtAt: null }),
    /abc1234-dirty/,
  );
});

test("the packed app ships build-info.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(
    pkg.build.files.includes("desktop/build-info.json"),
    "build-info.json must be in electron-builder files, or the stamp never reaches the app",
  );
  assert.ok(
    pkg.build.files.includes("desktop/gen-build-info.cjs"),
    "gen-build-info.cjs must ship — main.cjs requires it at runtime",
  );
});
