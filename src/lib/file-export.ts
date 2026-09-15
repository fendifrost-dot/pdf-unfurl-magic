/**
 * Save / share a generated PDF.
 * - Electron: native Save dialog
 * - Phone browsers: Share Sheet when the OS allows file shares, else download
 * - Desktop browsers: download
 */
import { isDesktopApp } from "./desktop";
import { canSharePdfFile } from "./platform";

export type ExportBytes = Uint8Array | ArrayBuffer;

function toUint8(bytes: ExportBytes): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function toPdfBlob(bytes: ExportBytes) {
  const data = toUint8(bytes);
  return new Blob([data.slice(0) as unknown as BlobPart], { type: "application/pdf" });
}

function triggerDownload(bytes: ExportBytes, filename: string) {
  const url = URL.createObjectURL(toPdfBlob(bytes));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Always persist locally: Electron Save dialog, or the browser download. */
export async function saveBytes(bytes: ExportBytes, filename: string): Promise<void> {
  const desktop = typeof window === "undefined" ? undefined : window.pdfReliefDesktop;
  if (desktop) {
    await desktop.saveFile({ name: filename, data: new Uint8Array(toUint8(bytes).slice(0)) });
    return;
  }
  triggerDownload(bytes, filename);
}

/** Offer the OS share sheet. Returns false if the user cancelled or share is unavailable. */
export async function shareBytes(bytes: ExportBytes, filename: string): Promise<boolean> {
  if (isDesktopApp() || !canSharePdfFile()) return false;
  const file = new File([toPdfBlob(bytes)], filename, { type: "application/pdf" });
  try {
    await navigator.share({ files: [file], title: filename, text: filename });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
    return false;
  }
}

/**
 * Phone: share if possible, otherwise download.
 * Electron / desktop browser: save only (no share sheet).
 */
export async function saveOrShareBytes(bytes: ExportBytes, filename: string): Promise<void> {
  if (isDesktopApp()) {
    await saveBytes(bytes, filename);
    return;
  }
  if (canSharePdfFile()) {
    const shared = await shareBytes(bytes, filename);
    if (shared) return;
  }
  await saveBytes(bytes, filename);
}

export function canOfferShare() {
  return canSharePdfFile();
}
