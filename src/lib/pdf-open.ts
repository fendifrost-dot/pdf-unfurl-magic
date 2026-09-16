/**
 * Open-path for password-protected PDFs.
 *
 * pdf.js decrypts for viewing. pdf-lib cannot rewrite encrypted streams, so
 * a successful unlock is view-only when the file is still encrypted. The
 * password is remembered for this tab session (same file bytes) so Edit,
 * home, and E-Sign do not re-prompt.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { isPdfEncrypted, sha256Hex } from "./pdf-io";
import { openDocument } from "./pdf-runtime";

export const PDF_PASSWORD_NEED = "need-password" as const;
export const PDF_PASSWORD_INCORRECT = "incorrect-password" as const;

export type PdfPasswordKind = typeof PDF_PASSWORD_NEED | typeof PDF_PASSWORD_INCORRECT;

export const PDF_PASSWORD_NEED_MESSAGE =
  "This PDF is password-protected. Enter the password to open it. Nothing is uploaded.";

export const PDF_PASSWORD_INCORRECT_MESSAGE =
  "That password did not unlock the file. Check it and try again. Nothing left this computer.";

export const PDF_OPEN_DAMAGED_MESSAGE =
  "This PDF could not be opened here. The file may be damaged. Try re-exporting it from the app that made it.";

export const VIEW_ONLY_ENCRYPTED_MESSAGE =
  "You can view this file. Editing, splitting, merging, signing, and Save As are blocked so the encrypted file is not damaged. Export an unencrypted copy from the app that created it if you need to change it.";

export const VIEW_ONLY_OWNER_RESTRICTION_MESSAGE =
  "This PDF allows viewing but not changes (owner restrictions). You can read it here; editing, splitting, merging, signing, and Save As are blocked so the file is not damaged.";

/** pdf.js PermissionFlag.MODIFY_CONTENTS */
const MODIFY_CONTENTS = 0x08;

export class PdfPasswordError extends Error {
  readonly kind: PdfPasswordKind;

  constructor(kind: PdfPasswordKind, message: string) {
    super(message);
    this.name = "PdfPasswordError";
    this.kind = kind;
  }
}

export function isPdfPasswordError(error: unknown): error is PdfPasswordError {
  return error instanceof PdfPasswordError;
}

export function classifyPasswordError(error: unknown): PdfPasswordKind | null {
  if (!error || typeof error !== "object") return null;
  const err = error as { name?: string; message?: string; code?: number };
  const name = err.name ?? "";
  const message = (err.message ?? "").toLowerCase();
  const passwordShaped =
    name === "PasswordException" || name === "PdfPasswordError" || message.includes("password");
  if (!passwordShaped) return null;
  if (err.code === 2 || message.includes("incorrect") || message.includes("invalid password")) {
    return PDF_PASSWORD_INCORRECT;
  }
  return PDF_PASSWORD_NEED;
}

const sessionPasswords = new Map<string, string>();

export function clearPdfPasswordSession(): void {
  sessionPasswords.clear();
}

export function rememberPdfPassword(fileHash: string, password: string): void {
  sessionPasswords.set(fileHash, password);
}

export function recalledPdfPassword(fileHash: string): string | undefined {
  return sessionPasswords.get(fileHash);
}

export type OpenedPdf = {
  bytes: ArrayBuffer;
  password: string;
  proxy: PDFDocumentProxy;
  pageCount: number;
  encrypted: boolean;
  canMutate: boolean;
  restrictionMessage: string | null;
};

async function openWithPassword(bytes: ArrayBuffer, password: string): Promise<PDFDocumentProxy> {
  try {
    return await openDocument(bytes, password);
  } catch (error) {
    const kind = classifyPasswordError(error);
    if (kind === PDF_PASSWORD_INCORRECT) {
      throw new PdfPasswordError(kind, PDF_PASSWORD_INCORRECT_MESSAGE);
    }
    if (kind === PDF_PASSWORD_NEED) {
      throw new PdfPasswordError(kind, PDF_PASSWORD_NEED_MESSAGE);
    }
    throw error;
  }
}

/**
 * Open bytes with pdf.js. Empty password first (plain files and owner-only
 * encryption). On NEED_PASSWORD, reuse a session password for this file hash,
 * or throw so the UI can prompt.
 */
export async function openPdfBytes(bytes: ArrayBuffer, password?: string): Promise<OpenedPdf> {
  const copy = bytes.slice(0);
  const fileHash = await sha256Hex(copy);
  const provided = password !== undefined;
  const usedPassword = provided ? password : (sessionPasswords.get(fileHash) ?? "");

  let proxy: PDFDocumentProxy;
  try {
    proxy = await openWithPassword(copy, usedPassword);
  } catch (error) {
    if (
      !provided &&
      isPdfPasswordError(error) &&
      error.kind === PDF_PASSWORD_INCORRECT &&
      sessionPasswords.has(fileHash)
    ) {
      sessionPasswords.delete(fileHash);
      throw new PdfPasswordError(PDF_PASSWORD_NEED, PDF_PASSWORD_NEED_MESSAGE);
    }
    throw error;
  }

  const encrypted = await isPdfEncrypted(copy);
  const permissions = await proxy.getPermissions();
  const modifyAllowed = permissions == null || permissions.includes(MODIFY_CONTENTS);
  const canMutate = !encrypted;
  let restrictionMessage: string | null = null;
  if (encrypted) {
    restrictionMessage = modifyAllowed
      ? VIEW_ONLY_ENCRYPTED_MESSAGE
      : VIEW_ONLY_OWNER_RESTRICTION_MESSAGE;
    rememberPdfPassword(fileHash, usedPassword);
  }

  return {
    bytes: copy,
    password: usedPassword,
    proxy,
    pageCount: proxy.numPages,
    encrypted,
    canMutate,
    restrictionMessage,
  };
}
