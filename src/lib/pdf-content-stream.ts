/**
 * PDF content-stream tokenizer and text-show walker.
 *
 * Used to rewrite a single Tj / TJ run instead of painting a white rectangle
 * over the old glyphs (the Acrobat TouchUp_TextEdit failure mode).
 */

import { decodeShowBytes, encodeWinAnsiBytes, foldPdfPunctuation } from "./pdf-font-match";

export type TokenKind =
  | "ws"
  | "comment"
  | "num"
  | "name"
  | "string"
  | "hex"
  | "op"
  | "inline-image"
  | "["
  | "]"
  | "<<"
  | ">>";

export type Token = {
  kind: TokenKind;
  raw: string;
  value?: string | number;
  bytes?: Uint8Array;
};

export type TextShow = {
  /** Inclusive token index of the first operand (or "[" for TJ). */
  start: number;
  /** Inclusive token index of the operator. */
  end: number;
  operator: "Tj" | "TJ" | "'" | '"';
  text: string;
  /** Raw shown bytes (literal / hex / TJ concat). Used to reuse CID glyphs. */
  bytes: Uint8Array;
  fontName: string;
  fontSize: number;
  x: number;
  y: number;
  fill: { r: number; g: number; b: number };
};

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);

export function bytesToLatin1(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

export function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function tokenizeContentStream(input: Uint8Array | string): Token[] {
  const src = typeof input === "string" ? input : bytesToLatin1(input);
  const tokens: Token[] = [];
  let i = 0;

  const push = (token: Token) => {
    tokens.push(token);
  };

  while (i < src.length) {
    const code = src.charCodeAt(i);

    if (WS.has(code)) {
      const start = i;
      while (i < src.length && WS.has(src.charCodeAt(i))) i++;
      push({ kind: "ws", raw: src.slice(start, i) });
      continue;
    }

    if (src[i] === "%") {
      const start = i;
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
      push({ kind: "comment", raw: src.slice(start, i) });
      continue;
    }

    if (src[i] === "(") {
      const parsed = readLiteralString(src, i);
      push(parsed.token);
      i = parsed.next;
      continue;
    }

    if (src.startsWith("<<", i)) {
      push({ kind: "<<", raw: "<<" });
      i += 2;
      continue;
    }

    if (src.startsWith(">>", i)) {
      push({ kind: ">>", raw: ">>" });
      i += 2;
      continue;
    }

    if (src[i] === "<") {
      const parsed = readHexString(src, i);
      push(parsed.token);
      i = parsed.next;
      continue;
    }

    if (src[i] === "[") {
      push({ kind: "[", raw: "[" });
      i += 1;
      continue;
    }

    if (src[i] === "]") {
      push({ kind: "]", raw: "]" });
      i += 1;
      continue;
    }

    if (src[i] === "/") {
      const parsed = readName(src, i);
      push(parsed.token);
      i = parsed.next;
      continue;
    }

    if (src[i] === "+" || src[i] === "-" || src[i] === "." || (code >= 48 && code <= 57)) {
      const parsed = readNumber(src, i);
      if (parsed) {
        push(parsed.token);
        i = parsed.next;
        continue;
      }
    }

    const start = i;
    while (i < src.length && !WS.has(src.charCodeAt(i)) && !isDelimiter(src[i] ?? "")) i++;
    const raw = src.slice(start, i);
    if (!raw) {
      i += 1;
      continue;
    }
    if (raw === "BI") {
      const end = findInlineImageEnd(src, i);
      push({ kind: "inline-image", raw: src.slice(start, end) });
      i = end;
      continue;
    }
    push({ kind: "op", raw, value: raw });
  }

  return tokens;
}

function isDelimiter(ch: string): boolean {
  return "()<>[]{}/%".includes(ch);
}

function readName(src: string, start: number): { token: Token; next: number } {
  let i = start + 1;
  let value = "";
  while (i < src.length && !WS.has(src.charCodeAt(i)) && !isDelimiter(src[i] ?? "")) {
    if (src[i] === "#" && i + 2 < src.length) {
      const hex = src.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        value += String.fromCharCode(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    value += src[i];
    i += 1;
  }
  return { token: { kind: "name", raw: src.slice(start, i), value }, next: i };
}

function readNumber(src: string, start: number): { token: Token; next: number } | null {
  const match = src.slice(start).match(/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/);
  if (!match?.[0]) return null;
  const raw = match[0];
  const nextChar = src[start + raw.length];
  if (nextChar && !WS.has(src.charCodeAt(start + raw.length)) && !isDelimiter(nextChar)) {
    return null;
  }
  return {
    token: { kind: "num", raw, value: Number(raw) },
    next: start + raw.length,
  };
}

function readLiteralString(src: string, start: number): { token: Token; next: number } {
  const bytes: number[] = [];
  let i = start + 1;
  let depth = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "(") {
      depth += 1;
      bytes.push(0x28);
      i += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
      bytes.push(0x29);
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === undefined) break;
      if (next === "n") bytes.push(0x0a);
      else if (next === "r") bytes.push(0x0d);
      else if (next === "t") bytes.push(0x09);
      else if (next === "b") bytes.push(0x08);
      else if (next === "f") bytes.push(0x0c);
      else if (next === "(" || next === ")" || next === "\\") bytes.push(next.charCodeAt(0));
      else if (next === "\n") {
        i += 2;
        continue;
      } else if (next === "\r") {
        i += src[i + 2] === "\n" ? 3 : 2;
        continue;
      } else if (next >= "0" && next <= "7") {
        let oct = next;
        let consumed = 1;
        const second = src[i + 2];
        if (second !== undefined && second >= "0" && second <= "7") {
          oct += second;
          consumed += 1;
        }
        const third = src[i + 1 + consumed];
        if (third !== undefined && third >= "0" && third <= "7") {
          oct += third;
          consumed += 1;
        }
        bytes.push(parseInt(oct, 8) & 0xff);
        i += 1 + consumed;
        continue;
      } else {
        bytes.push(next.charCodeAt(0));
      }
      i += 2;
      continue;
    }
    if (ch === undefined) break;
    bytes.push(ch.charCodeAt(0) & 0xff);
    i += 1;
  }
  return {
    token: {
      kind: "string",
      raw: src.slice(start, i),
      bytes: Uint8Array.from(bytes),
      value: decodeShowBytes(Uint8Array.from(bytes)),
    },
    next: i,
  };
}

function readHexString(src: string, start: number): { token: Token; next: number } {
  let i = start + 1;
  let hex = "";
  while (i < src.length && src[i] !== ">") {
    const ch = src[i];
    if (!WS.has(src.charCodeAt(i))) hex += ch;
    i += 1;
  }
  if (src[i] === ">") i += 1;
  if (hex.length % 2 === 1) hex += "0";
  const bytes = new Uint8Array(hex.length / 2);
  for (let n = 0; n < bytes.length; n++) {
    bytes[n] = parseInt(hex.slice(n * 2, n * 2 + 2), 16);
  }
  return {
    token: {
      kind: "hex",
      raw: src.slice(start, i),
      bytes,
      value: decodeShowBytes(bytes),
    },
    next: i,
  };
}

function findInlineImageEnd(src: string, from: number): number {
  const id = src.indexOf("ID", from);
  if (id < 0) return src.length;
  let i = id + 2;
  while (i < src.length) {
    if (
      src.startsWith("EI", i) &&
      (i + 2 >= src.length || WS.has(src.charCodeAt(i + 2)) || isDelimiter(src[i + 2] ?? ""))
    ) {
      return i + 2;
    }
    i += 1;
  }
  return src.length;
}

export function encodePdfLiteral(text: string): Token {
  const bytes = encodeWinAnsiBytes(text);
  let raw = "(";
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      raw += "\\" + String.fromCharCode(byte);
    } else if (byte === 0x0a) raw += "\\n";
    else if (byte === 0x0d) raw += "\\r";
    else if (byte >= 0x20 && byte <= 0x7e) raw += String.fromCharCode(byte);
    else raw += "\\" + byte.toString(8).padStart(3, "0");
  }
  raw += ")";
  return { kind: "string", raw, bytes, value: text };
}

export function encodePdfHex(bytes: Uint8Array, text = decodeShowBytes(bytes)): Token {
  let raw = "<";
  for (const byte of bytes) raw += byte.toString(16).padStart(2, "0").toUpperCase();
  raw += ">";
  return { kind: "hex", raw, bytes, value: text };
}

export function tokensToBytes(tokens: Token[]): Uint8Array {
  return latin1ToBytes(tokens.map((t) => t.raw).join(""));
}

export function normalizePdfText(text: string): string {
  return foldPdfPunctuation(text).replace(/\s+/g, " ").trim();
}

/** Keep commas/periods; only collapse whitespace. Used to match “2,500.00”. */
export function textMatchKey(text: string): string {
  return normalizePdfText(text);
}

/**
 * Matching-only key: allow a missing thousands separator so PDF.js “2 500.00”
 * still finds the content-stream run “2,500.00”. Never used for export text.
 */
export function looseAmountKey(text: string): string {
  return textMatchKey(text).replace(/(?<=\d)[, ](?=\d{3}(?:\D|$))/g, "");
}

/**
 * Matching-only key: treat “Debit- Debit” and “Debit - Debit” as the same run.
 * Hyphens stay in the exported text; this is only for locating operators.
 */
export function softMatchKey(text: string): string {
  return textMatchKey(text).replace(/\s*-\s*/g, "-");
}

function isThousandsComma(text: string, index: number): boolean {
  return (
    text[index] === "," && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "")
  );
}

function isAlignSkipped(text: string, index: number): boolean {
  const ch = text[index] ?? "";
  if (!ch || /\s/.test(ch)) return true;
  const folded = foldPdfPunctuation(ch);
  if (!folded || /\s/.test(folded)) return true;
  if (folded === "-" || folded === "\u00ad") return true;
  if (isThousandsComma(text, index)) return true;
  return false;
}

function alignChars(text: string): Array<{ ch: string; index: number }> {
  const out: Array<{ ch: string; index: number }> = [];
  for (let i = 0; i < text.length; i++) {
    if (isAlignSkipped(text, i)) continue;
    const folded = foldPdfPunctuation(text[i] ?? "");
    if (!folded) continue;
    out.push({ ch: folded, index: i });
  }
  return out;
}

/**
 * Locate `needle` inside a longer show (statement lines, PDF.js fragments).
 * Aligns letters/digits/currency while ignoring hyphen/space/thousands-comma
 * differences so “06 POS Debit- Debit Card 6205” still hits the operator.
 */
export function findFuzzySpan(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  if (!haystack || !needle.trim()) return null;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };

  const foldedNeedle = foldPdfPunctuation(needle);
  if (foldedNeedle && foldedNeedle !== needle) {
    const foldedAt = haystack.indexOf(foldedNeedle);
    if (foldedAt >= 0) return { start: foldedAt, end: foldedAt + foldedNeedle.length };
  }

  const h = alignChars(haystack);
  const n = alignChars(needle);
  if (n.length < 6 || h.length < n.length) return null;
  for (let i = 0; i <= h.length - n.length; i++) {
    let ok = true;
    for (let j = 0; j < n.length; j++) {
      if (h[i + j]?.ch !== n[j]?.ch) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const start = h[i]?.index;
    const last = h[i + n.length - 1]?.index;
    if (start === undefined || last === undefined) return null;
    return { start, end: last + 1 };
  }
  return null;
}

/** Replace a PDF.js fragment inside a content-stream show, keeping neighbors. */
export function spliceHaystack(haystack: string, needle: string, next: string): string | null {
  const span = findFuzzySpan(haystack, needle);
  if (!span) return null;
  return haystack.slice(0, span.start) + next + haystack.slice(span.end);
}

export function hasTextOperators(tokens: Token[]): boolean {
  return tokens.some(
    (token) =>
      token.kind === "op" &&
      (token.value === "Tj" || token.value === "TJ" || token.value === "'" || token.value === '"'),
  );
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

type GState = {
  ctm: Matrix;
  fill: { r: number; g: number; b: number };
};

function cloneState(state: GState): GState {
  return { ctm: [...state.ctm] as Matrix, fill: { ...state.fill } };
}

function num(token: Token | undefined): number {
  return typeof token?.value === "number" ? token.value : 0;
}

function decodeStringToken(token: Token | undefined): string {
  if (!token) return "";
  if (token.bytes) return decodeShowBytes(token.bytes);
  if (typeof token.value === "string") return token.value;
  return "";
}

function concatTokenBytes(tokens: Token[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const token of tokens) {
    if ((token.kind === "string" || token.kind === "hex") && token.bytes) {
      chunks.push(token.bytes);
      total += token.bytes.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readOperandWindow(tokens: Token[], opIndex: number): { operands: Token[]; start: number } {
  const operands: Token[] = [];
  let i = opIndex - 1;
  let depth = 0;
  while (i >= 0) {
    const token = tokens[i];
    if (!token) break;
    if (token.kind === "ws" || token.kind === "comment") {
      i -= 1;
      continue;
    }
    if (token.kind === "op" || token.kind === "inline-image") break;
    if (token.kind === "]" || token.kind === ">>") {
      depth += 1;
      operands.push(token);
      i -= 1;
      continue;
    }
    if (token.kind === "[" || token.kind === "<<") {
      operands.push(token);
      depth -= 1;
      i -= 1;
      if (depth <= 0 && operands.length > 0) break;
      continue;
    }
    operands.push(token);
    if (depth === 0) {
      // Keep collecting numbers/names/strings that belong to this operator.
      // Stop when the previous significant token is another operator — already handled.
    }
    i -= 1;
  }
  operands.reverse();
  // Trim to the operands that actually belong to this operator by walking forward
  // from the first non-ws token after the previous operator — the reverse scan
  // above already stopped at the previous operator. Good enough.
  const start = operands[0] ? tokens.indexOf(operands[0]) : opIndex;
  return { operands, start };
}

function tjTextFromOperands(operands: Token[]): string {
  let text = "";
  let inArray = false;
  for (const token of operands) {
    if (token.kind === "[") {
      inArray = true;
      continue;
    }
    if (token.kind === "]") {
      inArray = false;
      continue;
    }
    if (token.kind === "string" || token.kind === "hex") {
      text += decodeStringToken(token);
      continue;
    }
    if (inArray && token.kind === "num") {
      // Large negative TJ kerning is how many producers write a word space.
      // Small kerning (amounts like 2,500.00) must not invent a space.
      const kern = typeof token.value === "number" ? token.value : 0;
      if (kern < -180 && !text.endsWith(" ")) text += " ";
    }
  }
  return text;
}

/**
 * Walk a tokenized content stream and collect every text-showing operator
 * with the graphics / text state at that point.
 */
export function collectTextShows(tokens: Token[]): TextShow[] {
  const shows: TextShow[] = [];
  const stack: GState[] = [];
  let g: GState = { ctm: [...IDENTITY] as Matrix, fill: { r: 0, g: 0, b: 0 } };
  let textMatrix: Matrix = [...IDENTITY] as Matrix;
  let textLineMatrix: Matrix = [...IDENTITY] as Matrix;
  let fontName = "";
  let fontSize = 0;
  let leading = 0;
  let inText = false;

  const significant = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token.kind !== "ws" && token.kind !== "comment");

  for (let n = 0; n < significant.length; n++) {
    const current = significant[n];
    if (!current) continue;
    const { token, index } = current;
    if (token.kind !== "op") continue;
    const op = String(token.value ?? token.raw);
    const prev = (count: number): Token[] => {
      const out: Token[] = [];
      for (let k = n - count; k < n; k++) {
        const item = significant[k];
        if (item) out.push(item.token);
      }
      return out;
    };

    if (op === "q") {
      stack.push(cloneState(g));
      continue;
    }
    if (op === "Q") {
      const popped = stack.pop();
      if (popped) g = popped;
      continue;
    }
    if (op === "cm") {
      const p = prev(6);
      if (p.length === 6) {
        g.ctm = multiply(g.ctm, [num(p[0]), num(p[1]), num(p[2]), num(p[3]), num(p[4]), num(p[5])]);
      }
      continue;
    }
    if (op === "rg") {
      const p = prev(3);
      if (p.length === 3) g.fill = { r: num(p[0]), g: num(p[1]), b: num(p[2]) };
      continue;
    }
    if (op === "g") {
      const p = prev(1);
      const v = num(p[0]);
      g.fill = { r: v, g: v, b: v };
      continue;
    }
    if (op === "k") {
      const p = prev(4);
      if (p.length === 4) {
        const c = num(p[0]);
        const m = num(p[1]);
        const y = num(p[2]);
        const k = num(p[3]);
        g.fill = {
          r: 1 - Math.min(1, c + k),
          g: 1 - Math.min(1, m + k),
          b: 1 - Math.min(1, y + k),
        };
      }
      continue;
    }
    if (op === "BT") {
      inText = true;
      textMatrix = [...IDENTITY] as Matrix;
      textLineMatrix = [...IDENTITY] as Matrix;
      continue;
    }
    if (op === "ET") {
      inText = false;
      continue;
    }
    if (op === "Tf") {
      const p = prev(2);
      const nameTok = p[0];
      const sizeTok = p[1];
      if (nameTok?.kind === "name") fontName = String(nameTok.value ?? "");
      fontSize = num(sizeTok);
      continue;
    }
    if (op === "Tm") {
      const p = prev(6);
      if (p.length === 6) {
        textMatrix = [num(p[0]), num(p[1]), num(p[2]), num(p[3]), num(p[4]), num(p[5])];
        textLineMatrix = [...textMatrix] as Matrix;
      }
      continue;
    }
    if (op === "Td" || op === "TD") {
      const p = prev(2);
      const tx = num(p[0]);
      const ty = num(p[1]);
      if (op === "TD") leading = -ty;
      textLineMatrix = multiply(textLineMatrix, [1, 0, 0, 1, tx, ty]);
      textMatrix = [...textLineMatrix] as Matrix;
      continue;
    }
    if (op === "T*") {
      textLineMatrix = multiply(textLineMatrix, [1, 0, 0, 1, 0, -leading]);
      textMatrix = [...textLineMatrix] as Matrix;
      continue;
    }
    if (op === "TL") {
      leading = num(prev(1)[0]);
      continue;
    }

    if (op === "Tj" || op === "TJ" || op === "'" || op === '"') {
      if (op === "'" || op === '"') {
        textLineMatrix = multiply(textLineMatrix, [1, 0, 0, 1, 0, -leading]);
        textMatrix = [...textLineMatrix] as Matrix;
      }
      const window = readOperandWindow(tokens, index);
      let operands = window.operands;
      if (op === '"') {
        // aw ac string "
        operands = operands.slice(-1);
      }
      const text =
        op === "TJ"
          ? tjTextFromOperands(window.operands)
          : decodeStringToken(operands[operands.length - 1]);
      const bytes = concatTokenBytes(op === "TJ" ? window.operands : operands.slice(-1));
      const pos = applyMatrix(g.ctm, textMatrix[4], textMatrix[5]);
      shows.push({
        start: window.start,
        end: index,
        operator: op,
        text,
        bytes,
        fontName,
        fontSize,
        x: pos.x,
        y: pos.y,
        fill: { ...g.fill },
      });
      continue;
    }

    void inText;
  }

  return shows;
}

export function replaceShowText(tokens: Token[], show: TextShow, nextText: string): Token[] {
  const encoded = encodePdfLiteral(nextText);
  const before = tokens.slice(0, show.start);
  const after = tokens.slice(show.end + 1);
  const gap: Token[] = [{ kind: "ws", raw: " " }];
  return [...before, encoded, ...gap, { kind: "op", raw: "Tj", value: "Tj" }, ...after];
}

export function replaceShowBytes(
  tokens: Token[],
  show: TextShow,
  nextBytes: Uint8Array,
  nextText: string,
): Token[] {
  const encoded = encodePdfHex(nextBytes, nextText);
  const before = tokens.slice(0, show.start);
  const after = tokens.slice(show.end + 1);
  return [
    ...before,
    encoded,
    { kind: "ws", raw: " " },
    { kind: "op", raw: "Tj", value: "Tj" },
    ...after,
  ];
}

/** Concatenate adjacent shows on one baseline (multi-run invoice lines). */
export function joinAdjacentShows(shows: TextShow[], start: number, count: number): string {
  return shows
    .slice(start, start + count)
    .map((show) => show.text)
    .join("");
}

export function removeShow(tokens: Token[], show: TextShow): Token[] {
  const before = tokens.slice(0, show.start);
  const after = tokens.slice(show.end + 1);
  return [...before, { kind: "ws", raw: " " }, ...after];
}

export function extractShownStrings(tokens: Token[]): string[] {
  return collectTextShows(tokens).map((s) => s.text);
}

export function hasWhiteCoverRect(
  tokens: Token[],
  nearby: { x: number; y: number; width: number; height: number },
): boolean {
  const significant = tokens.filter((t) => t.kind !== "ws" && t.kind !== "comment");
  for (let i = 0; i < significant.length; i++) {
    const token = significant[i];
    if (token?.kind !== "op" || (token.value !== "re" && token.raw !== "re")) continue;
    const nums: number[] = [];
    for (let k = i - 4; k < i; k++) {
      const prev = significant[k];
      if (prev?.kind === "num" && typeof prev.value === "number") nums.push(prev.value);
    }
    if (nums.length !== 4) continue;
    const [x, y, w, h] = nums as [number, number, number, number];
    const overlaps =
      x <= nearby.x + nearby.width &&
      x + w >= nearby.x &&
      y <= nearby.y + nearby.height &&
      y + h >= nearby.y;
    if (!overlaps) continue;
    // Look backward for a white fill colour.
    for (let k = i - 1; k >= Math.max(0, i - 12); k--) {
      const prev = significant[k];
      if (prev?.kind !== "op") continue;
      if (prev.value === "rg" || prev.raw === "rg") {
        const r = significant[k - 3];
        const g = significant[k - 2];
        const b = significant[k - 1];
        const white =
          typeof r?.value === "number" &&
          typeof g?.value === "number" &&
          typeof b?.value === "number" &&
          r.value > 0.97 &&
          g.value > 0.97 &&
          b.value > 0.97;
        if (white) return true;
      }
      if (prev.value === "g" || prev.raw === "g") {
        const v = significant[k - 1];
        if (typeof v?.value === "number" && v.value > 0.97) return true;
      }
    }
  }
  return false;
}
