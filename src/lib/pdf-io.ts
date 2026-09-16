/**
 * Shared PDF load / hash / download helpers.
 * Editor patches, scan tools, and E-Sign all go through these so page
 * graphics are never rasterized just to open or save a file.
 *
 * Encrypted files are opened for viewing via pdf.js (see pdf-open.ts).
 * pdf-lib cannot rewrite encrypted streams without corrupting them, so
 * mutate paths refuse encryption instead of calling ignoreEncryption.
 */
import { EncryptedPDFError, PDFDocument } from "pdf-lib";

export const ENCRYPTED_MUTATION_MESSAGE =
  "This PDF is password-protected. You can view it after unlocking, but PDF Relief will not split, merge, edit, or save a new copy — rewriting encrypted streams would damage the file.";

export class PdfEncryptedMutationError extends Error {
  constructor(message = ENCRYPTED_MUTATION_MESSAGE) {
    super(message);
    this.name = "PdfEncryptedMutationError";
  }
}

function isEncryptedLoadError(error: unknown): boolean {
  return (
    error instanceof EncryptedPDFError ||
    (error instanceof Error && /encrypted/i.test(error.message))
  );
}

export async function isPdfEncrypted(bytes: ArrayBuffer): Promise<boolean> {
  const doc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
  return doc.isEncrypted;
}

export async function loadPdfDocument(
  bytes: ArrayBuffer,
  options?: { updateMetadata?: boolean },
): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes.slice(0), {
      updateMetadata: options?.updateMetadata,
    });
  } catch (error) {
    if (isEncryptedLoadError(error)) {
      throw new PdfEncryptedMutationError();
    }
    throw error;
  }
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytesToArrayBuffer(bytes));
}
