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
        const wave = Math.sin(y * 0.18 + Math.sin(x * 0.028) * 4.4);
        const stripe = Math.sin((y + n0 * 6) * 0.55) * 18;
        const knot = Math.exp(-(((x - width * 0.68) ** 2 + (y - height * 0.42) ** 2) / 280));
        const vignette = 1 - Math.hypot(nx - 0.5, ny - 0.45) * 0.35;
        r = (132 + wave * 36 + stripe + n1 * 22 + knot * 55) * vignette;
        g = (78 + wave * 20 + stripe * 0.5 + n1 * 12 + knot * 16) * vignette;
        b = (38 + wave * 8 + n1 * 8 + knot * 6) * vignette;
      } else {
        const window = nx > 0.56 && nx < 0.94 && ny > 0.1 && ny < 0.46;
        const pane = window && (Math.abs(nx - 0.75) < 0.012 || Math.abs(ny - 0.28) < 0.018);
        const cabinet = ny > 0.52 && ny < 0.84 && (nx < 0.48 || nx > 0.52);
        const door = cabinet && (Math.abs(nx - 0.24) < 0.01 || Math.abs(nx - 0.74) < 0.01);
        const counter = ny > 0.84 && ny < 0.93;
        const kettle = Math.hypot(nx - 0.22, ny - 0.78) < 0.06;
        const wall = !window && !cabinet && !counter && !kettle;
        if (window && !pane) {
          r = 120 + (1 - ny) * 90 + n0 * 20;
          g = 160 + (1 - ny) * 50 + n0 * 12;
          b = 210 + n0 * 10;
        } else if (pane) {
          r = 86;
          g = 96;
          b = 112;
        } else if (kettle) {
          r = 46;
          g = 52;
          b = 58;
        } else if (door) {
          r = 72;
          g = 46;
          b = 28;
        } else if (cabinet) {
          const grain = Math.sin(x * 0.55 + ny * 8) * 14;
          r = 142 + grain + n1 * 10;
          g = 86 + grain * 0.5 + n1 * 6;
          b = 44 + n1 * 4;
        } else if (counter) {
          r = 188 + n0 * 14;
          g = 176 + n0 * 10;
          b = 162;
        } else if (wall) {
          r = 232 + n0 * 6;
          g = 220 + n0 * 5;
          b = 200;
        }
        if (kind === "washout") {
          r = 140 + r * 0.55;
          g = 138 + g * 0.55;
          b = 136 + b * 0.55;
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
