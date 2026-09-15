/**
 * Save As / Close document UX. Apply is session-only; writes always go to a
 * new PDF name and never reuse the uploaded source filename.
 */

export const SAVE_AS_LABEL = "Save As…";
export const EXPORT_ALIAS_LABEL = "Export";
export const CLOSE_DOCUMENT_LABEL = "Close document";
export const OPEN_ANOTHER_PDF_LABEL = "Open another PDF";

export const SAVE_AS_HINT =
  "Writes a new PDF. Never overwrites the file you opened.";

export const APPLY_SESSION_HINT =
  "Preview only — this tab, not disk. Save As… writes a new PDF and never overwrites the file you opened.";

/** True when the suggested download/save name would collide with the source. */
export function isSamePdfBaseName(originalName: string, suggestedName: string): boolean {
  const orig = originalName.replace(/\.pdf$/i, "").trim().toLowerCase();
  const next = suggestedName.replace(/\.pdf$/i, "").trim().toLowerCase();
  return orig.length > 0 && orig === next;
}

/**
 * Browser download / dialog default: always a NEW name, never the uploaded file.
 * Prefers the caller’s suggestion when it already differs (`*-edited.pdf`,
 * `*-marked.pdf`, …); otherwise appends `-edited`.
 */
export function ensureNewPdfName(originalName: string, suggestedName?: string): string {
  const origBase = originalName.replace(/\.pdf$/i, "").trim() || "document";
  let next = (suggestedName ?? "").trim();
  if (!next) next = `${origBase}-edited.pdf`;
  if (!/\.pdf$/i.test(next)) next = `${next}.pdf`;
  if (isSamePdfBaseName(origBase, next)) return `${origBase}-edited.pdf`;
  return next;
}
