/**
 * Builds a tiny Standard-security (RC4-128) encrypted PDF for tests and
 * `fixtures/password-open.pdf`. Not a product encryptor — pdf-lib cannot
 * write encrypted files, and we do not add encryption to exports.
 */
import { createHash } from "node:crypto";

/** User password for the committed `password-open.pdf` fixture. */
export const PASSWORD_OPEN_FIXTURE_PASSWORD = "pdfrelief";

/** Owner password — different from the user password so permissions apply. */
export const PASSWORD_OPEN_FIXTURE_OWNER = "pdfrelief-owner";

/** Text drawn on the fixture page; used by tests after a successful unlock. */
export const PASSWORD_OPEN_MARKER = "PASSWORD_OPEN_OK";

/**
 * Permission flags with bit 4 (modify contents) clear. View / print / copy
 * stay on; rewriting the file is what we refuse.
 * Bits 7–8 and 13–32 must be 1 per the PDF spec.
 */
export const PASSWORD_OPEN_NO_MODIFY_P = -12;

const PASSWORD_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const encoder = new TextEncoder();

export type PasswordOpenPdfOptions = {
  userPassword?: string;
  ownerPassword?: string;
  marker?: string;
  /** Signed 32-bit /P value. Default blocks modify-contents. */
  permissions?: number;
};

export function buildPasswordOpenPdf(options: PasswordOpenPdfOptions = {}): Uint8Array {
  const userPassword = options.userPassword ?? PASSWORD_OPEN_FIXTURE_PASSWORD;
  const ownerPassword = options.ownerPassword ?? PASSWORD_OPEN_FIXTURE_OWNER;
  const marker = options.marker ?? PASSWORD_OPEN_MARKER;
  const P = options.permissions ?? PASSWORD_OPEN_NO_MODIFY_P;
  const keyLen = 16;

  const id = md5(encoder.encode("pdf-relief/password-open-fixture"));
  const O = computeO(userPassword, ownerPassword, keyLen);
  const key = fileEncryptionKey(userPassword, O, P, id, keyLen);
  const U = computeU(key, id);

  const streamPlain = encoder.encode(`BT /F1 18 Tf 72 720 Td (${pdfLiteral(marker)}) Tj ET\n`);
  const streamCrypt = rc4(objectKey(key, 4, 0), streamPlain);

  const objects = [
    objectBytes(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    objectBytes(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    objectBytes(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    ),
    streamObject(4, streamCrypt),
    objectBytes(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    objectBytes(
      6,
      `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O <${hex(O)}> /U <${hex(U)}> >>`,
    ),
  ];

  return assembleEncryptedPdf(objects, id);
}

function md5(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("md5").update(data).digest());
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function pdfLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function padPassword(password: string): Uint8Array {
  const raw = encoder.encode(password).subarray(0, 32);
  const out = new Uint8Array(32);
  out.set(raw);
  if (raw.length < 32) out.set(PASSWORD_PADDING.subarray(0, 32 - raw.length), raw.length);
  return out;
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    const tmp = s[i]!;
    s[i] = s[j]!;
    s[j] = tmp;
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 255;
    b = (b + s[a]!) & 255;
    const tmp = s[a]!;
    s[a] = s[b]!;
    s[b] = tmp;
    out[k] = data[k]! ^ s[(s[a]! + s[b]!) & 255]!;
  }
  return out;
}

/** Algorithm 3.3 — O entry, revision 3. */
function computeO(userPassword: string, ownerPassword: string, keyLen: number): Uint8Array {
  const ownerPad = padPassword(ownerPassword || userPassword);
  let hash = md5(ownerPad);
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, keyLen));
  const key = hash.subarray(0, keyLen);
  let data = padPassword(userPassword);
  data = rc4(key, data);
  for (let i = 1; i <= 19; i++) {
    const xorKey = new Uint8Array(key.length);
    for (let j = 0; j < key.length; j++) xorKey[j] = key[j]! ^ i;
    data = rc4(xorKey, data);
  }
  return data;
}

/** Algorithm 3.2 — file encryption key from the user password. */
function fileEncryptionKey(
  userPassword: string,
  O: Uint8Array,
  P: number,
  id: Uint8Array,
  keyLen: number,
): Uint8Array {
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, P, true);
  let hash = md5(concat(padPassword(userPassword), O, pBytes, id));
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, keyLen));
  return hash.subarray(0, keyLen);
}

/** Algorithm 3.5 — U entry, revision 3. */
function computeU(fileKey: Uint8Array, id: Uint8Array): Uint8Array {
  let data = rc4(fileKey, md5(concat(PASSWORD_PADDING, id)));
  for (let i = 1; i <= 19; i++) {
    const xorKey = new Uint8Array(fileKey.length);
    for (let j = 0; j < fileKey.length; j++) xorKey[j] = fileKey[j]! ^ i;
    data = rc4(xorKey, data);
  }
  const U = new Uint8Array(32);
  U.set(data);
  return U;
}

function objectKey(fileKey: Uint8Array, objNum: number, gen: number): Uint8Array {
  const extra = new Uint8Array(5);
  extra[0] = objNum & 0xff;
  extra[1] = (objNum >> 8) & 0xff;
  extra[2] = (objNum >> 16) & 0xff;
  extra[3] = gen & 0xff;
  extra[4] = (gen >> 8) & 0xff;
  const hash = md5(concat(fileKey, extra));
  return hash.subarray(0, Math.min(fileKey.length + 5, 16));
}

function objectBytes(num: number, body: string): Uint8Array {
  return encoder.encode(`${num} 0 obj\n${body}\nendobj\n`);
}

function streamObject(num: number, data: Uint8Array): Uint8Array {
  return concat(
    encoder.encode(`${num} 0 obj\n<< /Length ${data.length} >>\nstream\n`),
    data,
    encoder.encode("\nendstream\nendobj\n"),
  );
}

function assembleEncryptedPdf(objects: Uint8Array[], id: Uint8Array): Uint8Array {
  const header = encoder.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const parts: Uint8Array[] = [header];
  const offsets = [0];
  let length = header.length;
  for (const obj of objects) {
    offsets.push(length);
    parts.push(obj);
    length += obj.length;
  }
  const xrefStart = length;
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  parts.push(
    encoder.encode(
      `${xref}trailer\n<< /Size ${count} /Root 1 0 R /Encrypt 6 0 R /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    ),
  );
  return concat(...parts);
}
