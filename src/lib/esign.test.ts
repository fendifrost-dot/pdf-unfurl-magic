import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { sha256Hex, sha256HexOfBytes } from "./pdf-io";
import {
  buildSampleContractPdf,
  buildSignedExport,
  createSigner,
  newId,
  sampleContractSetup,
  sidecarJson,
  type SignField,
} from "./esign";

/** 1×1 opaque PNG */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("sample contract keeps two pages of original graphics before export", async () => {
  const bytes = await buildSampleContractPdf();
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
});

test("signed export appends a certificate page and a three-hash sidecar", async () => {
  const source = await buildSampleContractPdf();
  const sourceBuffer = source.buffer.slice(
    source.byteOffset,
    source.byteOffset + source.byteLength,
  ) as ArrayBuffer;
  const expectedSource = await sha256Hex(sourceBuffer);
  const { signers, fields } = sampleContractSetup();
  const first = signers[0];
  assert.ok(first);

  const filled: SignField[] = fields.map((field) => {
    if (field.signerId !== first.id) return field;
    if (field.kind === "signature" || field.kind === "initials") {
      return {
        ...field,
        signedAt: "2026-09-14T12:00:00.000Z",
        value: { kind: field.kind, pngDataUrl: TINY_PNG, method: "draw" },
      };
    }
    return {
      ...field,
      signedAt: "2026-09-14T12:00:00.000Z",
      value: { kind: "date", text: "14 Sep 2026" },
    };
  });

  const exported = await buildSignedExport({
    sourceBytes: sourceBuffer,
    sourceFileName: "workshop-agreement.pdf",
    signers,
    fields: filled,
  });

  assert.equal(exported.hashes.sourceSha256, expectedSource);
  assert.notEqual(exported.hashes.annotatedSha256, exported.hashes.sourceSha256);
  assert.notEqual(exported.hashes.signedFileSha256, exported.hashes.annotatedSha256);
  assert.equal(await sha256HexOfBytes(exported.pdf), exported.hashes.signedFileSha256);

  const signed = await PDFDocument.load(exported.pdf);
  assert.equal(signed.getPageCount(), 3);

  const json = sidecarJson(exported.sidecar);
  assert.match(json, /PDF Relief E-Sign/);
  assert.match(json, /sourceSha256/);
  assert.match(json, /annotatedSha256/);
  assert.match(json, /signedFileSha256/);
  assert.equal(exported.sidecar.signers[0]?.completed, true);
  assert.equal(exported.sidecar.signers[1]?.completed, false);
  assert.ok(exported.sidecar.fields.some((field) => field.filled && field.method === "draw"));
});

test("changing the source file changes sourceSha256", async () => {
  const a = await buildSampleContractPdf();
  const copy = a.slice();
  assert.equal(await sha256HexOfBytes(copy), await sha256HexOfBytes(a));
  const mutated = a.slice();
  mutated[mutated.length - 1] = (mutated[mutated.length - 1] ?? 0) ^ 0xff;
  assert.notEqual(await sha256HexOfBytes(a), await sha256HexOfBytes(mutated));

  const signer = createSigner({ name: "Pat", order: 1 });
  const field: SignField = {
    id: newId("field"),
    kind: "text",
    page: 1,
    x: 60,
    y: 400,
    width: 120,
    height: 20,
    signerId: signer.id,
    required: true,
    value: { kind: "text", text: "OK" },
    signedAt: "2026-09-14T12:00:00.000Z",
  };
  const sourceBuffer = a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
  const exported = await buildSignedExport({
    sourceBytes: sourceBuffer,
    sourceFileName: "a.pdf",
    signers: [signer],
    fields: [field],
  });
  assert.equal(exported.hashes.sourceSha256, await sha256HexOfBytes(a));
});
