/**
 * Dependency-free RGBA PNG encoder (uncompressed DEFLATE).
 * Used for workshop sample photos so Node and the browser share the same bytes.
 */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const idx = (c ^ (bytes[i] ?? 0)) & 0xff;
    c = (CRC_TABLE[idx] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a += bytes[i] ?? 0;
    if (a >= 65521) a -= 65521;
    b += a;
    if (b >= 65521) b -= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(8 + data.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

/** zlib-wrapped uncompressed DEFLATE of `raw`. */
function zlibStore(raw: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  const max = 65535;
  for (let offset = 0; offset < raw.length; offset += max) {
    const slice = raw.subarray(offset, Math.min(offset + max, raw.length));
    const last = offset + max >= raw.length;
    const block = new Uint8Array(5 + slice.length);
    block[0] = last ? 1 : 0;
    block[1] = slice.length & 0xff;
    block[2] = (slice.length >>> 8) & 0xff;
    const nlen = slice.length ^ 0xffff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >>> 8) & 0xff;
    block.set(slice, 5);
    blocks.push(block);
  }
  const deflateSize = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(2 + deflateSize + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let p = 2;
  for (const block of blocks) {
    out.set(block, p);
    p += block.length;
  }
  out.set(u32(adler32(raw)), p);
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error("PNG pixel buffer does not match width × height.");
  }
  const stride = 1 + width * 4;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }

  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStore(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function hash(x: number, y: number, salt: number): number {
  let n = Math.imul(x + salt * 17, 374761393) ^ Math.imul(y + salt * 31, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function clamp(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

export type DemoPhotoKind = "oak" | "kitchen" | "washout";

/** Procedural sample photos — distinct enough to select, crop, and tone-adjust. */
export function demoPhotoPixels(kind: DemoPhotoKind, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const nx = x / width;
      const ny = y / height;
      const n0 = hash(x, y, 1);
      const n1 = hash(x, y, 7);
      let r = 0;
      let g = 0;
      let b = 0;

      if (kind === "oak") {
        const grain = Math.sin(y * 0.22 + Math.sin(x * 0.035) * 3.2 + n0 * 0.8);
        const knot = Math.exp(-(((x - width * 0.62) ** 2 + (y - height * 0.38) ** 2) / 420));
        r = 148 + grain * 28 + n1 * 18 + knot * 40;
        g = 96 + grain * 18 + n1 * 10 + knot * 12;
        b = 52 + grain * 8 + n1 * 6;
      } else {
        const window = nx > 0.58 && nx < 0.92 && ny > 0.08 && ny < 0.42;
        const pane = window && (Math.abs(nx - 0.75) < 0.01 || Math.abs(ny - 0.25) < 0.015);
        const cabinet = ny > 0.55 && ny < 0.88 && (nx < 0.46 || nx > 0.54);
        const counter = ny > 0.86;
        const wall = !window && !cabinet && !counter;
        if (window && !pane) {
          r = 232 + n0 * 18;
          g = 236 + n0 * 14;
          b = 242;
        } else if (pane) {
          r = 168;
          g = 176;
          b = 188;
        } else if (cabinet) {
          const grain = Math.sin(x * 0.4 + ny * 2) * 10;
          r = 118 + grain + n1 * 12;
          g = 72 + grain * 0.6 + n1 * 8;
          b = 42 + n1 * 6;
        } else if (counter) {
          r = 210 + n0 * 10;
          g = 198 + n0 * 8;
          b = 184;
        } else if (wall) {
          r = 214 + n0 * 8;
          g = 204 + n0 * 6;
          b = 188;
        }
        if (kind === "washout") {
          r = 210 + r * 0.22;
          g = 208 + g * 0.22;
          b = 205 + b * 0.22;
        }
      }

      rgba[i] = clamp(r);
      rgba[i + 1] = clamp(g);
      rgba[i + 2] = clamp(b);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

export function encodeDemoPhoto(kind: DemoPhotoKind, width: number, height: number): Uint8Array {
  return encodePng(width, height, demoPhotoPixels(kind, width, height));
}
