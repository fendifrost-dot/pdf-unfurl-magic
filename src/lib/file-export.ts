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

/**
 * What a save actually did. `path` is only set in the desktop app, where the
 * user picked a location — a browser download has no path to report.
 */
export type SaveOutcome = {
  /** False when the desktop Save dialog was cancelled: nothing reached the disk. */
  saved: boolean;
  desktop: boolean;
  path: string | null;
};

/** Always persist locally: Electron Save dialog, or the browser download. */
export async function saveBytesWithResult(
  bytes: ExportBytes,
  filename: string,
): Promise<SaveOutcome> {
  const desktop = typeof window === "undefined" ? undefined : window.pdfReliefDesktop;
  if (desktop) {
    const savedPath = await desktop.saveFile({
      name: filename,
      data: new Uint8Array(toUint8(bytes).slice(0)),
    });
    return { saved: Boolean(savedPath), desktop: true, path: savedPath ?? null };
  }
  triggerDownload(bytes, filename);
  return { saved: true, desktop: false, path: null };
}

/** Always persist locally: Electron Save dialog, or the browser download. */
export async function saveBytes(bytes: ExportBytes, filename: string): Promise<void> {
  await saveBytesWithResult(bytes, filename);
}

/**
 * Write a small text sidecar for a file `saveBytesWithResult` just saved.
 * Desktop: lands beside the chosen file, same base name, no second dialog.
 * Browser: a second download.
 * Never throws — a sidecar failure must not undo or block the main export.
 */
export async function saveTextSidecar(options: {
  outcome: SaveOutcome;
  /** Full sidecar extension, e.g. ".esign.json". Must be allow-listed in main.cjs. */
  extension: string;
  /** Filename for the browser download fallback. */
  downloadName: string;
  text: string;
  mime?: string;
}): Promise<boolean> {
  const { outcome, extension, downloadName, text, mime = "application/json" } = options;
  if (!outcome.saved) return false;
  try {
    const data = new TextEncoder().encode(text);
    const desktop = typeof window === "undefined" ? undefined : window.pdfReliefDesktop;
    if (outcome.desktop) {
      if (!outcome.path || !desktop?.saveSidecar) return false;
      const written = await desktop.saveSidecar({
        forPath: outcome.path,
        extension,
        data: new Uint8Array(data.slice(0)),
      });
      return Boolean(written);
    }
    const url = URL.createObjectURL(
      new Blob([data.slice(0) as unknown as BlobPart], { type: mime }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    a.rel = "noopener";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
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
