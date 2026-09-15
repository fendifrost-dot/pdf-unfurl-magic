import {
  approxQuadFromHull,
  clampQuad,
  convexHull,
  dist,
  insetQuad,
  orderQuad,
  quadArea,
  rectangularity,
  scaleQuad,
  type Point,
  type Quad,
} from "./geometry";
import { SCAN_DETECT_EDGE, type DetectedDocument } from "./types";

function toGray(data: ImageData): Uint8Array {
  const gray = new Uint8Array(data.width * data.height);
  const src = data.data;
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    gray[p] = (src[i]! * 77 + src[i + 1]! * 150 + src[i + 2]! * 29) >> 8;
  }
  return gray;
}

function boxBlurGray(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return src.slice();
  const tmp = new Uint32Array(width * height);
  const out = new Uint8Array(width * height);
  const window = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += src[y * width + clampIndex(x, width)]!;
    }
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum;
      sum +=
        src[y * width + clampIndex(x + radius + 1, width)]! -
        src[y * width + clampIndex(x - radius, width)]!;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += tmp[clampIndex(y, height) * width + x]!;
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / (window * window));
      sum +=
        tmp[clampIndex(y + radius + 1, height) * width + x]! -
        tmp[clampIndex(y - radius, height) * width + x]!;
    }
  }
  return out;
}

function clampIndex(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value;
}

function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]! += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let max = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      threshold = t;
    }
  }
  return threshold;
}

function sobelMagnitude(gray: Uint8Array, width: number, height: number): Float32Array {
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1]! +
        gray[i - width + 1]! -
        2 * gray[i - 1]! +
        2 * gray[i + 1]! -
        gray[i + width - 1]! +
        gray[i + width + 1]!;
      const gy =
        gray[i - width - 1]! +
        2 * gray[i - width]! +
        gray[i - width + 1]! -
        gray[i + width - 1]! -
        2 * gray[i + width]! -
        gray[i + width + 1]!;
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

function largestBlob(
  binary: Uint8Array,
  width: number,
  height: number,
  want: number,
): Uint8Array | null {
  const seen = new Uint8Array(width * height);
  let best: number[] = [];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < binary.length; start++) {
    if (binary[start] !== want || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const cells: number[] = [];
    while (top > 0) {
      const idx = stack[--top]!;
      cells.push(idx);
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x > 0 && !seen[idx - 1] && binary[idx - 1] === want) {
        seen[idx - 1] = 1;
        stack[top++] = idx - 1;
      }
      if (x + 1 < width && !seen[idx + 1] && binary[idx + 1] === want) {
        seen[idx + 1] = 1;
        stack[top++] = idx + 1;
      }
      if (y > 0 && !seen[idx - width] && binary[idx - width] === want) {
        seen[idx - width] = 1;
        stack[top++] = idx - width;
      }
      if (y + 1 < height && !seen[idx + width] && binary[idx + width] === want) {
        seen[idx + width] = 1;
        stack[top++] = idx + width;
      }
    }
    if (cells.length > best.length) best = cells;
  }
  if (best.length < width * height * 0.06) return null;
  const mask = new Uint8Array(width * height);
  for (const i of best) mask[i] = 1;
  return mask;
}

function borderPoints(mask: Uint8Array, width: number, height: number): Point[] {
  const points: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !mask[i - 1] ||
        !mask[i + 1] ||
        !mask[i - width] ||
        !mask[i + width];
      if (edge) points.push({ x, y });
    }
  }
  if (points.length > 900) {
    const step = Math.ceil(points.length / 900);
    return points.filter((_, index) => index % step === 0);
  }
  return points;
}

function quadFromMask(mask: Uint8Array, width: number, height: number): Quad | null {
  const border = borderPoints(mask, width, height);
  if (border.length < 8) return null;
  const hull = convexHull(border);
  if (hull.length < 3) return null;
  return clampQuad(approxQuadFromHull(hull), width, height);
}

function dilateBinary(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = src.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (src[i]) continue;
      if (src[i - 1] || src[i + 1] || src[i - width] || src[i + width]) out[i] = 1;
    }
  }
  return out;
}

function meanEdgeAlongQuad(quad: Quad, mag: Float32Array, width: number, height: number): number {
  let sum = 0;
  let count = 0;
  for (let s = 0; s < 4; s++) {
    const a = quad[s]!;
    const b = quad[(s + 1) % 4]!;
    const steps = Math.max(8, Math.round(dist(a, b)));
    for (let t = 0; t <= steps; t++) {
      const x = Math.round(a.x + ((b.x - a.x) * t) / steps);
      const y = Math.round(a.y + ((b.y - a.y) * t) / steps);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      sum += mag[y * width + x]!;
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

function scoreQuad(quad: Quad, mag: Float32Array, width: number, height: number): number {
  const area = quadArea(quad) / (width * height);
  if (area < 0.1 || area > 0.98) return 0;
  const rect = rectangularity(quad);
  if (rect < 0.45) return 0;
  const edge = meanEdgeAlongQuad(quad, mag, width, height);
  return area * (0.55 + 0.45 * rect) * (0.25 + Math.min(edge, 180) / 180);
}

function downscaleForDetect(source: ImageData): {
  data: ImageData;
  scaleX: number;
  scaleY: number;
} {
  const maxSide = Math.max(source.width, source.height);
  if (maxSide <= SCAN_DETECT_EDGE) {
    return { data: source, scaleX: 1, scaleY: 1 };
  }
  const scale = SCAN_DETECT_EDGE / maxSide;
  const width = Math.max(32, Math.round(source.width * scale));
  const height = Math.max(32, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  const tmp = document.createElement("canvas");
  tmp.width = source.width;
  tmp.height = source.height;
  const tctx = tmp.getContext("2d");
  if (!tctx) throw new Error("Canvas is unavailable in this browser.");
  tctx.putImageData(source, 0, 0);
  ctx.drawImage(tmp, 0, 0, width, height);
  return {
    data: ctx.getImageData(0, 0, width, height),
    scaleX: source.width / width,
    scaleY: source.height / height,
  };
}

/**
 * Find document bounds on a photo. Fast path is a bright-paper blob;
 * edges are a fallback. Always returns a quad so the user can nudge it.
 */
export function detectDocumentQuad(source: ImageData): DetectedDocument {
  const { data, scaleX, scaleY } = downscaleForDetect(source);
  const width = data.width;
  const height = data.height;
  const gray = boxBlurGray(toGray(data), width, height, 1);
  const mag = sobelMagnitude(gray, width, height);
  const threshold = otsuThreshold(gray);
  // Include mid-tone ink/headers (sienna bars, marker) — not only near-white paper.
  const paperCut = Math.min(threshold - 4, 78);
  const paper = new Uint8Array(gray.length);
  let bright = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i]! >= paperCut) {
      paper[i] = 1;
      bright += 1;
    }
  }
  const paperRatio = bright / gray.length;
  const candidates: Quad[] = [];

  if (paperRatio > 0.08 && paperRatio < 0.93) {
    const grown = dilateBinary(dilateBinary(paper, width, height), width, height);
    const mask = largestBlob(grown, width, height, 1);
    if (mask) {
      const quad = quadFromMask(mask, width, height);
      if (quad) candidates.push(quad);
    }
  }

  let magMax = 1;
  for (const v of mag) if (v > magMax) magMax = v;
  const edges = new Uint8Array(mag.length);
  const cut = magMax * 0.22;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i]! >= cut) edges[i] = 1;
  }
  const closed = dilateBinary(dilateBinary(edges, width, height), width, height);
  const edgeBlob = largestBlob(closed, width, height, 1);
  if (edgeBlob) {
    const quad = quadFromMask(edgeBlob, width, height);
    if (quad) candidates.push(quad);
  }

  candidates.push(insetQuad(width, height, 0.07));

  let best = candidates[0]!;
  let bestScore = -1;
  for (const quad of candidates) {
    const ordered = orderQuad(quad);
    const score = scoreQuad(ordered, mag, width, height);
    if (score > bestScore) {
      bestScore = score;
      best = ordered;
    }
  }

  return {
    quad: clampQuad(scaleQuad(best, scaleX, scaleY), source.width, source.height),
    confidence: clamp01(bestScore),
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
