/**
 * Shared smoke harness for PDF Relief.
 *
 *   npm run test:smoke
 *
 * Checks every fixture: load, page count, and export-size sanity
 * (split / extract / merge / a one-line text patch).
 *
 * Product UI is not launched here. See tests/e2e/README.md for the
 * Playwright / Vitest path that opens the app.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadFixture, readManifest } from "./helpers/load-fixture.mjs";
import {
  applyTextPatch,
  assertExportSizeSane,
  extractPages,
  getPageCount,
  mergeFiles,
  splitIntoChunks,
} from "./helpers/pdf-ops.mjs";

const manifest = await readManifest();

test("manifest lists the five committed fixtures", () => {
  const files = manifest.files.map((f) => f.file).sort();
  assert.deepEqual(files, [
    "image-and-text.pdf",
    "lines-and-text.pdf",
    "multi-font.pdf",
    "multi-page.pdf",
    "simple-text.pdf",
  ]);
});

test("each fixture loads with the advertised page count and stays small", async () => {
  for (const item of manifest.files) {
    const { bytes, doc } = await loadFixture(item.file);
    assert.equal(doc.getPageCount(), item.pages, item.file);
    assert.equal(await getPageCount(bytes), item.pages, `${item.file} getPageCount`);
    assert.ok(bytes.byteLength > 200, `${item.file} too small`);
    assert.ok(bytes.byteLength <= item.maxBytes, `${item.file} ${bytes.byteLength} > ${item.maxBytes}`);
    assert.match(Buffer.from(bytes).toString("latin1"), /^%PDF-/);
  }
});

test("multi-page split / extract / merge: page counts and export sizes are sane", async () => {
  const { bytes } = await loadFixture("multi-page.pdf");
  const chunks = await splitIntoChunks(bytes, "multi-page", 1);
  assert.equal(chunks.length, 3);
  for (const chunk of chunks) {
    assert.equal(chunk.pages, 1);
    assertExportSizeSane(chunk.name, chunk.bytes, bytes, { minRatio: 0.15, maxRatio: 1.2 });
  }

  const extracted = await extractPages(bytes, "multi-page", [2, 3]);
  assert.equal(extracted.pages, 2);
  assert.equal(await getPageCount(extracted.bytes), 2);
  assertExportSizeSane("extract 2-3", extracted.bytes, bytes, { minRatio: 0.25, maxRatio: 1.1 });

  const simple = await loadFixture("simple-text.pdf");
  const merged = await mergeFiles([
    { name: "simple-text.pdf", bytes: simple.bytes },
    { name: "multi-page.pdf", bytes },
  ]);
  assert.equal(merged.pages, 4);
  assertExportSizeSane("merge simple+multi", merged.bytes, bytes, { minRatio: 0.8, maxRatio: 3 });
});

test("a one-line text-patch export stays in a sane size band", async () => {
  for (const name of ["simple-text.pdf", "multi-font.pdf", "lines-and-text.pdf", "image-and-text.pdf"]) {
    const { bytes } = await loadFixture(name);
    const exported = await applyTextPatch(bytes, "SMOKE_PATCH");
    assert.equal(await getPageCount(exported), 1, name);
    assert.match(Buffer.from(exported.subarray(0, 5)).toString("latin1"), /%PDF-/);
    assert.notEqual(exported.byteLength, new Uint8Array(bytes).byteLength, `${name} patch should rewrite bytes`);
    assertExportSizeSane(`${name} patched`, exported, bytes, { minRatio: 0.5, maxRatio: 3 });
  }
});
