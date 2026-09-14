/**
 * PDF Relief E-Sign — local electronic signatures.
 *
 * Marks are drawn on top of the existing page content stream. pdf-lib
 * appends operators; it does not rasterize or rewrite underlying graphics.
 *
 * Integrity is SHA-256 of file bytes, not a PKI / PAdES digital signature.
 * See buildSignedExport() and the certificate page for the hash chain.
 */
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { loadPdfDocument, sha256Hex, sha256HexOfBytes } from "./pdf-io";

export const ESIGN_PRODUCT = "PDF Relief E-Sign";
export const ESIGN_SIDECAR_VERSION = 1;

export type FieldKind = "signature" | "initials" | "date" | "text";
export type SignerRole = "signer" | "approver" | "witness";
export type MarkMethod = "draw" | "type" | "upload";

export type Signer = {
  id: string;
  name: string;
  email: string;
  role: SignerRole;
  order: number;
};

export type MarkValue = {
  kind: "signature" | "initials";
  pngDataUrl: string;
  method: MarkMethod;
};

export type TextValue = {
  kind: "date" | "text";
  text: string;
};

export type FieldValue = MarkValue | TextValue;

export type SignField = {
  id: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  signerId: string;
  required: boolean;
  value?: FieldValue;
  signedAt?: string;
};

export type EsignHashes = {
  sourceSha256: string;
  annotatedSha256: string;
  signedFileSha256: string;
};

export type EsignSidecar = {
  product: typeof ESIGN_PRODUCT;
  version: typeof ESIGN_SIDECAR_VERSION;
  generatedAt: string;
  sourceFileName: string;
  hashes: EsignHashes;
  signers: Array<
    Signer & {
      completed: boolean;
      signedAt: string | null;
    }
  >;
  fields: Array<{
    id: string;
    kind: FieldKind;
    page: number;
    signerId: string;
    required: boolean;
    filled: boolean;
    signedAt: string | null;
    method?: MarkMethod;
  }>;
  note: string;
};

export const FIELD_DEFAULTS: Record<FieldKind, { width: number; height: number; label: string }> = {
  signature: { width: 168, height: 52, label: "Signature" },
  initials: { width: 64, height: 40, label: "Initials" },
  date: { width: 112, height: 28, label: "Date" },
  text: { width: 160, height: 28, label: "Text" },
};

export const SIGNER_COLORS = ["#9a4a24", "#2f6b4f", "#3d5a80", "#7a4e2a", "#5c4d7a"] as const;

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createSigner(partial?: Partial<Signer> & { index?: number }): Signer {
  const index = partial?.index ?? 1;
  return {
    id: partial?.id ?? newId("signer"),
    name: partial?.name ?? `Signer ${index}`,
    email: partial?.email ?? "",
    role: partial?.role ?? "signer",
    order: partial?.order ?? index,
  };
}

export function fieldLabel(kind: FieldKind): string {
  return FIELD_DEFAULTS[kind].label;
}

function isMarkValue(value: FieldValue): value is MarkValue {
  return value.kind === "signature" || value.kind === "initials";
}

function isTextValue(value: FieldValue): value is TextValue {
  return value.kind === "date" || value.kind === "text";
}

export function isFieldFilled(field: SignField): boolean {
  if (!field.value) return false;
  if (isMarkValue(field.value)) return field.value.pngDataUrl.startsWith("data:image/");
  return field.value.text.trim().length > 0;
}

export function signerRequiredFields(signerId: string, fields: SignField[]): SignField[] {
  return fields.filter((field) => field.signerId === signerId && field.required);
}

export function signerIsComplete(signerId: string, fields: SignField[]): boolean {
  return signerRequiredFields(signerId, fields).every(isFieldFilled);
}

export function signerSignedAt(signerId: string, fields: SignField[]): string | null {
  const times = fields
    .filter((field) => field.signerId === signerId && field.signedAt)
    .map((field) => field.signedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return times[times.length - 1] ?? null;
}

/** Previous-order signers must finish before this one may sign. */
export function signerIsUnlocked(signer: Signer, signers: Signer[], fields: SignField[]): boolean {
  return signers
    .filter((other) => other.order < signer.order)
    .every((other) => signerIsComplete(other.id, fields));
}

export function nextUnlockedSigner(signers: Signer[], fields: SignField[]): Signer | null {
  const ordered = [...signers].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return (
    ordered.find(
      (signer) => signerIsUnlocked(signer, signers, fields) && !signerIsComplete(signer.id, fields),
    ) ?? null
  );
}

export function formatSignedDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error("That mark is not a usable image.");
  }
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}

export function renderTypedMark(text: string, kind: "signature" | "initials"): string {
  const value = text.trim();
  if (!value) throw new Error("Type a name or initials first.");
  const canvas = document.createElement("canvas");
  const width = kind === "initials" ? 420 : 720;
  const height = kind === "initials" ? 220 : 200;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#1b1814";
  const size =
    kind === "initials" ? 92 : Math.min(72, Math.max(36, 640 / Math.max(value.length, 4)));
  ctx.font = `600 ${size}px "Caveat", "Segoe Script", "Brush Script MT", cursive`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value, width / 2, height / 2 + 6);
  return canvas.toDataURL("image/png");
}

const SAMPLE_SIGNATURE = {
  page: 1,
  x: 56,
  y: 132,
  width: 200,
  height: 48,
} as const;

const SAMPLE_DATE = {
  page: 1,
  x: 360,
  y: 146,
  width: 120,
  height: 24,
} as const;

const SAMPLE_INITIALS = {
  page: 1,
  x: 500,
  y: 708,
  width: 52,
  height: 32,
} as const;

const SAMPLE_WITNESS = {
  page: 2,
  x: 56,
  y: 560,
  width: 200,
  height: 48,
} as const;

/** Two-page internal service agreement with known signature-line coordinates. */
export async function buildSampleContractPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([595, 842]);
  const page2 = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const body = await doc.embedFont(StandardFonts.TimesRoman);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const ink = rgb(0.12, 0.11, 0.1);
  const soft = rgb(0.4, 0.38, 0.35);

  const write = (
    page: PDFPage,
    text: string,
    y: number,
    opts: { size?: number; font?: typeof body; x?: number; color?: typeof ink } = {},
  ) => {
    page.drawText(text, {
      x: opts.x ?? 56,
      y,
      size: opts.size ?? 11,
      font: opts.font ?? body,
      color: opts.color ?? ink,
    });
  };

  write(page1, "PDF Relief — internal use only", 800, { size: 9, font: italic, color: soft });
  write(page1, "Workshop services agreement", 768, { size: 22, font: bold });
  write(page1, "Agreement 2026-ES-014", 748, { size: 11, color: soft });

  const paras = [
    "This agreement is between the workshop (PDF Relief) and the named signer for local document work.",
    "Files prepared under this agreement stay on the signer’s device. Nothing is uploaded to a signing service.",
    "The signer confirms they have authority to accept the scope below, and that the mark they apply is theirs.",
    "Scope: split, extract, merge, click-to-edit, and E-Sign of documents the workshop already holds.",
    "This sample is for trying E-Sign. It is not a real commercial contract and creates no obligation.",
  ];
  let y = 710;
  for (const para of paras) {
    write(page1, para, y, { size: 11 });
    y -= 36;
  }

  write(page1, "Initials", 716, { size: 8, x: 500, color: soft });
  page1.drawLine({
    start: { x: 500, y: 708 },
    end: { x: 552, y: 708 },
    thickness: 0.6,
    color: rgb(0.55, 0.52, 0.48),
  });

  write(page1, "Accepted by", 196, { size: 11, font: bold });
  page1.drawLine({
    start: { x: 56, y: 132 },
    end: { x: 256, y: 132 },
    thickness: 0.75,
    color: rgb(0.25, 0.22, 0.2),
  });
  write(page1, "Signature", 118, { size: 9, color: soft });

  page1.drawLine({
    start: { x: 360, y: 146 },
    end: { x: 500, y: 146 },
    thickness: 0.75,
    color: rgb(0.25, 0.22, 0.2),
  });
  write(page1, "Date", 132, { size: 9, x: 360, color: soft });

  write(page2, "Schedule A — second signer / witness", 780, { size: 16, font: bold });
  write(
    page2,
    "Leave this page for a later signer if you are preparing a multi-person packet.",
    752,
    { size: 11, color: soft },
  );
  write(page2, "Witness or countersigner", 620, { size: 11, font: bold });
  page2.drawLine({
    start: { x: 56, y: 560 },
    end: { x: 256, y: 560 },
    thickness: 0.75,
    color: rgb(0.25, 0.22, 0.2),
  });
  write(page2, "Signature", 546, { size: 9, color: soft });

  return doc.save();
}

export function sampleContractSetup(): { signers: Signer[]; fields: SignField[] } {
  const first = createSigner({
    name: "Alex Rivera",
    email: "alex@workshop.local",
    order: 1,
    index: 1,
  });
  const second = createSigner({
    name: "Witness",
    email: "",
    role: "witness",
    order: 2,
    index: 2,
  });
  const fields: SignField[] = [
    {
      id: newId("field"),
      kind: "signature",
      signerId: first.id,
      required: true,
      ...SAMPLE_SIGNATURE,
    },
    {
      id: newId("field"),
      kind: "date",
      signerId: first.id,
      required: true,
      ...SAMPLE_DATE,
    },
    {
      id: newId("field"),
      kind: "initials",
      signerId: first.id,
      required: true,
      ...SAMPLE_INITIALS,
    },
    {
      id: newId("field"),
      kind: "signature",
      signerId: second.id,
      required: true,
      ...SAMPLE_WITNESS,
    },
  ];
  return { signers: [first, second], fields };
}

async function embedMark(doc: PDFDocument, dataUrl: string) {
  const { bytes, mime } = dataUrlToBytes(dataUrl);
  if (mime.includes("jpeg") || mime.includes("jpg")) return doc.embedJpg(bytes);
  return doc.embedPng(bytes);
}

function drawFittedImage(page: PDFPage, image: PDFImage, field: SignField) {
  const fitted = image.scaleToFit(field.width, field.height);
  const x = field.x + (field.width - fitted.width) / 2;
  const y = field.y + (field.height - fitted.height) / 2;
  page.drawImage(image, { x, y, width: fitted.width, height: fitted.height });
}

async function applyFieldAppearances(doc: PDFDocument, fields: SignField[], signers: Signer[]) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const ink = rgb(0.12, 0.11, 0.1);
  const hint = rgb(0.45, 0.42, 0.38);

  for (const field of fields) {
    const page = pages[field.page - 1];
    if (!page) continue;
    const signer = signers.find((item) => item.id === field.signerId);
    const label = `${fieldLabel(field.kind)}${signer ? ` — ${signer.name}` : ""}`;

    if (!isFieldFilled(field) || !field.value) {
      page.drawRectangle({
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        borderColor: rgb(0.62, 0.5, 0.38),
        borderWidth: 0.8,
      });
      const size = Math.min(8, field.height * 0.4);
      page.drawText(label.slice(0, 42), {
        x: field.x + 3,
        y: field.y + Math.max(3, (field.height - size) / 2),
        size,
        font,
        color: hint,
      });
      continue;
    }

    if (isMarkValue(field.value)) {
      const image = await embedMark(doc, field.value.pngDataUrl);
      drawFittedImage(page, image, field);
      continue;
    }

    const text = isTextValue(field.value) ? field.value.text.replace(/\s*\n\s*/g, " ").trim() : "";
    let size = Math.min(12, field.height * 0.62);
    while (size > 6 && font.widthOfTextAtSize(text, size) > field.width - 4) size -= 0.25;
    page.drawText(text, {
      x: field.x + 2,
      y: field.y + Math.max(2, (field.height - size) * 0.28),
      size,
      font,
      color: ink,
    });
  }
}

function wrapLines(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function addCertificatePage(
  doc: PDFDocument,
  input: {
    sourceFileName: string;
    generatedAt: string;
    sourceSha256: string;
    annotatedSha256: string;
    signers: Signer[];
    fields: SignField[];
  },
) {
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const ink = rgb(0.12, 0.11, 0.1);
  const soft = rgb(0.4, 0.38, 0.35);
  let y = 792;

  const line = (
    text: string,
    opts: { size?: number; font?: typeof body; x?: number; color?: typeof ink } = {},
  ) => {
    page.drawText(text, {
      x: opts.x ?? 48,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? body,
      color: opts.color ?? ink,
    });
    y -= (opts.size ?? 10) + 6;
  };

  line("PDF Relief · E-Sign certificate", { size: 18, font: bold });
  line("Local audit record — not a DocuSign certificate, not a PKI digital signature.", {
    size: 9,
    color: soft,
  });
  y -= 8;
  line(`Document: ${input.sourceFileName}`, { size: 11 });
  line(`Generated: ${input.generatedAt}`, { size: 11 });
  y -= 6;
  line("Integrity (SHA-256 of file bytes)", { size: 12, font: bold });
  line("Source file (before any marks)", { size: 9, color: soft });
  for (const part of input.sourceSha256.match(/.{1,64}/g) ?? [input.sourceSha256]) {
    line(part, { size: 8, font: mono, x: 48 });
  }
  line("Signed content (original pages + marks, before this page)", { size: 9, color: soft });
  for (const part of input.annotatedSha256.match(/.{1,64}/g) ?? [input.annotatedSha256]) {
    line(part, { size: 8, font: mono, x: 48 });
  }
  y -= 4;
  const explain =
    "SHA-256 of this complete signed file (including this certificate) is written only in the sidecar .esign.json, because printing that digest on this page would change the digest. Re-hash the files you kept; they must match the sidecar.";
  for (const wrapped of wrapLines(explain, body, 9, 500)) {
    line(wrapped, { size: 9, color: soft });
  }

  y -= 8;
  line("Who signed", { size: 12, font: bold });
  const ordered = [...input.signers].sort((a, b) => a.order - b.order);
  for (const signer of ordered) {
    const done = signerIsComplete(signer.id, input.fields);
    const when = signerSignedAt(signer.id, input.fields);
    const filled = input.fields.filter(
      (field) => field.signerId === signer.id && isFieldFilled(field),
    ).length;
    const total = input.fields.filter((field) => field.signerId === signer.id).length;
    line(
      `${signer.order}. ${signer.name || "Unnamed"} · ${signer.role}${signer.email ? ` · ${signer.email}` : ""}`,
      { size: 10, font: bold },
    );
    line(
      done
        ? `Completed ${when ?? ""} · ${filled}/${total} fields`
        : `Pending · ${filled}/${total} fields filled`,
      { size: 9, color: soft },
    );
  }

  y -= 6;
  line("Fields", { size: 12, font: bold });
  for (const field of input.fields) {
    const signer = input.signers.find((item) => item.id === field.signerId);
    const method =
      field.value && (field.value.kind === "signature" || field.value.kind === "initials")
        ? ` · ${field.value.method}`
        : "";
    line(
      `p${field.page} ${fieldLabel(field.kind)} · ${signer?.name ?? "?"} · ${isFieldFilled(field) ? "locked" : "open"}${method}`,
      { size: 9 },
    );
  }
}

const SIDECAR_NOTE =
  "Hashes are SHA-256 of raw file bytes, computed in this browser. sourceSha256 is the PDF you opened. annotatedSha256 is that file after signature/initials/date/text marks were drawn onto existing pages (no raster rewrite). signedFileSha256 is the exported PDF including the certificate page. This is an attribution + integrity record for internal ESIGN/UETA-style use, not a certificate-authority digital signature. Not affiliated with DocuSign.";

export function buildSidecar(input: {
  sourceFileName: string;
  generatedAt: string;
  hashes: EsignHashes;
  signers: Signer[];
  fields: SignField[];
}): EsignSidecar {
  return {
    product: ESIGN_PRODUCT,
    version: ESIGN_SIDECAR_VERSION,
    generatedAt: input.generatedAt,
    sourceFileName: input.sourceFileName,
    hashes: input.hashes,
    signers: input.signers.map((signer) => ({
      ...signer,
      completed: signerIsComplete(signer.id, input.fields),
      signedAt: signerSignedAt(signer.id, input.fields),
    })),
    fields: input.fields.map((field) => {
      const method =
        field.value && (field.value.kind === "signature" || field.value.kind === "initials")
          ? field.value.method
          : undefined;
      return {
        id: field.id,
        kind: field.kind,
        page: field.page,
        signerId: field.signerId,
        required: field.required,
        filled: isFieldFilled(field),
        signedAt: field.signedAt ?? null,
        ...(method ? { method } : {}),
      };
    }),
    note: SIDECAR_NOTE,
  };
}

export async function buildSignedExport(input: {
  sourceBytes: ArrayBuffer;
  sourceFileName: string;
  signers: Signer[];
  fields: SignField[];
}): Promise<{ pdf: Uint8Array; sidecar: EsignSidecar; hashes: EsignHashes }> {
  const generatedAt = new Date().toISOString();
  const sourceSha256 = await sha256Hex(input.sourceBytes.slice(0));

  const working = await loadPdfDocument(input.sourceBytes);
  await applyFieldAppearances(working, input.fields, input.signers);
  const annotatedBytes = await working.save();
  const annotatedSha256 = await sha256HexOfBytes(annotatedBytes);

  const withCert = await loadPdfDocument(bytesToArrayBufferSafe(annotatedBytes));
  await addCertificatePage(withCert, {
    sourceFileName: input.sourceFileName,
    generatedAt,
    sourceSha256,
    annotatedSha256,
    signers: input.signers,
    fields: input.fields,
  });
  const pdf = await withCert.save();
  const signedFileSha256 = await sha256HexOfBytes(pdf);
  const hashes = { sourceSha256, annotatedSha256, signedFileSha256 };
  return {
    pdf,
    hashes,
    sidecar: buildSidecar({
      sourceFileName: input.sourceFileName,
      generatedAt,
      hashes,
      signers: input.signers,
      fields: input.fields,
    }),
  };
}

function bytesToArrayBufferSafe(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function sidecarJson(sidecar: EsignSidecar): string {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}
