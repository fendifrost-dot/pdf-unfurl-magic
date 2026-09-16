import { describe, expect, it, beforeEach } from "vitest";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PASSWORD_OPEN_FIXTURE_PASSWORD,
  PASSWORD_OPEN_MARKER,
  buildPasswordOpenPdf,
} from "./pdf-password-fixture";
import {
  ENCRYPTED_MUTATION_MESSAGE,
  isPdfEncrypted,
  loadPdfDocument,
  PdfEncryptedMutationError,
} from "./pdf-io";
import {
  PDF_PASSWORD_INCORRECT,
  PDF_PASSWORD_NEED,
  classifyPasswordError,
  clearPdfPasswordSession,
  openPdfBytes,
  isPdfPasswordError,
} from "./pdf-open";
import { buildSamplePdf } from "./pdf-tools";

GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function pageText(data: Uint8Array, password?: string): Promise<string> {
  const proxy = await getDocument({ data: data.slice(), password: password ?? "" }).promise;
  try {
    const page = await proxy.getPage(1);
    const content = await page.getTextContent();
    return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
  } finally {
    await proxy.destroy();
  }
}

describe("password-protected PDF open", () => {
  beforeEach(() => {
    clearPdfPasswordSession();
  });

  it("classifies pdf.js password exceptions", () => {
    expect(
      classifyPasswordError({ name: "PasswordException", code: 1, message: "No password given" }),
    ).toBe(PDF_PASSWORD_NEED);
    expect(
      classifyPasswordError({
        name: "PasswordException",
        code: 2,
        message: "Incorrect Password",
      }),
    ).toBe(PDF_PASSWORD_INCORRECT);
    expect(classifyPasswordError(new Error("bad xref"))).toBeNull();
  });

  it("builds an encrypted fixture that pdf.js opens only with the user password", async () => {
    const bytes = buildPasswordOpenPdf();
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    await expect(PDFDocument.load(bytes.slice())).rejects.toThrow(/encrypted/i);

    await expect(getDocument({ data: bytes.slice() }).promise).rejects.toMatchObject({
      name: "PasswordException",
    });
    await expect(
      getDocument({ data: bytes.slice(), password: "not-the-password" }).promise,
    ).rejects.toMatchObject({ name: "PasswordException", code: 2 });

    const text = await pageText(bytes, PASSWORD_OPEN_FIXTURE_PASSWORD);
    expect(text).toContain(PASSWORD_OPEN_MARKER);
  });

  it("openPdfBytes prompts, rejects a wrong password, then unlocks with the right one", async () => {
    const bytes = asBuffer(buildPasswordOpenPdf());
    await expect(openPdfBytes(bytes)).rejects.toMatchObject({
      kind: PDF_PASSWORD_NEED,
    });
    await expect(openPdfBytes(bytes, "nope")).rejects.toMatchObject({
      kind: PDF_PASSWORD_INCORRECT,
    });

    const opened = await openPdfBytes(bytes, PASSWORD_OPEN_FIXTURE_PASSWORD);
    try {
      expect(opened.pageCount).toBe(1);
      expect(opened.encrypted).toBe(true);
      expect(opened.canMutate).toBe(false);
      expect(opened.restrictionMessage).toMatch(/view/i);
      const page = await opened.proxy.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      expect(text).toContain(PASSWORD_OPEN_MARKER);
    } finally {
      await opened.proxy.destroy();
    }
  });

  it("remembers the password for the same bytes in this session", async () => {
    const bytes = asBuffer(buildPasswordOpenPdf());
    const first = await openPdfBytes(bytes, PASSWORD_OPEN_FIXTURE_PASSWORD);
    await first.proxy.destroy();
    const second = await openPdfBytes(bytes);
    try {
      expect(second.pageCount).toBe(1);
      expect(second.canMutate).toBe(false);
    } finally {
      await second.proxy.destroy();
    }
  });

  it("leaves unencrypted PDFs unchanged and mutable", async () => {
    const sample = await buildSamplePdf();
    const opened = await openPdfBytes(asBuffer(sample));
    try {
      expect(opened.encrypted).toBe(false);
      expect(opened.canMutate).toBe(true);
      expect(opened.restrictionMessage).toBeNull();
      expect(opened.pageCount).toBeGreaterThan(0);
    } finally {
      await opened.proxy.destroy();
    }
    const doc = await loadPdfDocument(asBuffer(sample));
    expect(doc.getPageCount()).toBe(opened.pageCount);
  });

  it("refuses pdf-lib mutation of an encrypted file instead of ignoreEncryption", async () => {
    const bytes = asBuffer(buildPasswordOpenPdf());
    expect(await isPdfEncrypted(bytes)).toBe(true);
    await expect(loadPdfDocument(bytes)).rejects.toBeInstanceOf(PdfEncryptedMutationError);
    await expect(loadPdfDocument(bytes)).rejects.toThrow(ENCRYPTED_MUTATION_MESSAGE);
  });

  it("opens owner-only encryption without a prompt and still blocks mutate", async () => {
    const bytes = asBuffer(
      buildPasswordOpenPdf({
        userPassword: "",
        ownerPassword: "pdfrelief-owner",
        marker: "OWNER_ONLY_OK",
      }),
    );
    const opened = await openPdfBytes(bytes);
    try {
      expect(opened.encrypted).toBe(true);
      expect(opened.canMutate).toBe(false);
      expect(opened.restrictionMessage).toMatch(/view/i);
      const page = await opened.proxy.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      expect(text).toContain("OWNER_ONLY_OK");
    } finally {
      await opened.proxy.destroy();
    }
  });

  it("committed password-open fixture matches the documented password", async () => {
    const buf = await readFile(join(process.cwd(), "fixtures/password-open.pdf"));
    const text = await pageText(new Uint8Array(buf), PASSWORD_OPEN_FIXTURE_PASSWORD);
    expect(text).toContain(PASSWORD_OPEN_MARKER);
  });
});

describe("isPdfPasswordError", () => {
  it("does not treat unrelated failures as a password prompt", () => {
    expect(isPdfPasswordError(new Error("bad xref"))).toBe(false);
  });
});
