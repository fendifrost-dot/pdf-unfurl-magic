/**
 * Shared PDF load / hash / download helpers.
 * Editor patches, scan tools, and E-Sign all go through these so page
 * graphics are never rasterized just to open or save a file.
 */
import { PDFDocument } from "pdf-lib";

export async function loadPdfDocument(bytes: ArrayBuffer): Promise<PDFDocument> {
  return PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
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
