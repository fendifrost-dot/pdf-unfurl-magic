/**
 * Tiny loader other feature tests can import without touching product code.
 *
 *   import { loadFixture, readManifest } from "../helpers/load-fixture.mjs";
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

export async function readManifest() {
  const raw = await readFile(join(FIXTURES_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw);
}

/** @returns {Promise<ArrayBuffer>} */
export async function readFixtureBytes(filename) {
  const buf = await readFile(join(FIXTURES_DIR, filename));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function loadFixture(filename) {
  const bytes = await readFixtureBytes(filename);
  const doc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
  return { filename, bytes, doc };
}
