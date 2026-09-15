import {
  applyHomography,
  invertHomography,
  outputSizeForQuad,
  solveHomography,
  type Quad,
} from "./geometry";
import { SCAN_MAX_EDGE } from "./types";

function sampleBilinear(data: ImageData, x: number, y: number): [number, number, number, number] {
  const w = data.width;
  const h = data.height;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return [0, 0, 0, 255];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const dx = x - x0;
  const dy = y - y0;
  const src = data.data;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return [0, 1, 2, 3].map((c) => {
    const top = mix(src[i00 + c]!, src[i10 + c]!, dx);
    const bot = mix(src[i01 + c]!, src[i11 + c]!, dx);
    return mix(top, bot, dy);
  }) as [number, number, number, number];
}

/** Perspective-correct a photo using the four document corners. */
export function warpPerspective(source: ImageData, quad: Quad, maxEdge = SCAN_MAX_EDGE): ImageData {
  const size = outputSizeForQuad(quad, maxEdge);
  const dest: Quad = [
    { x: 0, y: 0 },
    { x: size.width - 1, y: 0 },
    { x: size.width - 1, y: size.height - 1 },
    { x: 0, y: size.height - 1 },
  ];
  const destToSrc = invertHomography(solveHomography(quad, dest));
  const out = new Uint8ClampedArray(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const src = applyHomography(destToSrc, { x, y });
      const [r, g, b, a] = sampleBilinear(source, src.x, src.y);
      const o = (y * size.width + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return new ImageData(out, size.width, size.height);
}
