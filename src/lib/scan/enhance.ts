import type { EnhancePreset } from "./types";

function luma(r: number, g: number, b: number): number {
  return (r * 77 + g * 150 + b * 29) >> 8;
}

function boxBlurRgb(data: ImageData, radius: number): Uint8ClampedArray {
  const { width, height } = data;
  const src = data.data;
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  const window = radius * 2 + 1;
  const clamp = (v: number, max: number) => (v < 0 ? 0 : v >= max ? max - 1 : v);
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += src[(y * width + clamp(x, width)) * 4 + c]!;
      for (let x = 0; x < width; x++) {
        tmp[(y * width + x) * 4 + c] = sum / window;
        sum +=
          src[(y * width + clamp(x + radius + 1, width)) * 4 + c]! -
          src[(y * width + clamp(x - radius, width)) * 4 + c]!;
      }
    }
  }
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[(clamp(y, height) * width + x) * 4 + c]!;
      for (let y = 0; y < height; y++) {
        out[(y * width + x) * 4 + c] = sum / window;
        out[(y * width + x) * 4 + 3] = 255;
        sum +=
          tmp[(clamp(y + radius + 1, height) * width + x) * 4 + c]! -
          tmp[(clamp(y - radius, height) * width + x) * 4 + c]!;
      }
    }
  }
  return out;
}

function unsharp(data: ImageData, amount: number, radius = 1): void {
  const blur = boxBlurRgb(data, radius);
  const src = data.data;
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = src[i + c]! + amount * (src[i + c]! - blur[i + c]!);
      src[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

function autoLevels(data: ImageData, clip = 0.01): void {
  const src = data.data;
  const hist = [
    new Array<number>(256).fill(0),
    new Array<number>(256).fill(0),
    new Array<number>(256).fill(0),
  ];
  const pixels = src.length / 4;
  for (let i = 0; i < src.length; i += 4) {
    hist[0]![src[i]!]! += 1;
    hist[1]![src[i + 1]!]! += 1;
    hist[2]![src[i + 2]!]! += 1;
  }
  const cut = pixels * clip;
  const range = (h: number[]) => {
    let lo = 0;
    let hi = 255;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += h[i]!;
      if (acc >= cut) {
        lo = i;
        break;
      }
    }
    acc = 0;
    for (let i = 255; i >= 0; i--) {
      acc += h[i]!;
      if (acc >= cut) {
        hi = i;
        break;
      }
    }
    return [lo, Math.max(hi, lo + 1)] as const;
  };
  const ranges = hist.map(range);
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const [lo, hi] = ranges[c]!;
      src[i + c] = ((src[i + c]! - lo) * 255) / (hi - lo);
    }
  }
}

function grayscaleContrast(data: ImageData, gain: number, bias: number): void {
  const src = data.data;
  for (let i = 0; i < src.length; i += 4) {
    let y = (luma(src[i]!, src[i + 1]!, src[i + 2]!) - 128) * gain + 128 + bias;
    y = y < 0 ? 0 : y > 255 ? 255 : y;
    src[i] = y;
    src[i + 1] = y;
    src[i + 2] = y;
  }
}

function whiteboard(data: ImageData): void {
  const src = data.data;
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i]!;
    const g = src[i + 1]!;
    const b = src[i + 2]!;
    const y = luma(r, g, b);
    if (y > 168) {
      src[i] = 255;
      src[i + 1] = 255;
      src[i + 2] = 255;
      continue;
    }
    const punch = y < 90 ? 0.55 : 0.78;
    src[i] = Math.max(0, Math.min(255, (r - 18) * punch + 8));
    src[i + 1] = Math.max(0, Math.min(255, (g - 18) * punch + 8));
    src[i + 2] = Math.max(0, Math.min(255, (b - 18) * punch + 8));
  }
  unsharp(data, 0.7, 1);
}

function adaptiveBw(data: ImageData): void {
  const { width, height } = data;
  const src = data.data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < src.length; i += 4, p++)
    gray[p] = luma(src[i]!, src[i + 1]!, src[i + 2]!);
  const radius = Math.max(8, Math.round(Math.min(width, height) / 28));
  const integral = new Float64Array((width + 1) * (height + 1));
  const iw = width + 1;
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      row += gray[(y - 1) * width + (x - 1)]!;
      integral[y * iw + x] = integral[(y - 1) * iw + x]! + row;
    }
  }
  const areaSum = (x0: number, y0: number, x1: number, y1: number) => {
    return (
      integral[y1 * iw + x1]! -
      integral[y0 * iw + x1]! -
      integral[y1 * iw + x0]! +
      integral[y0 * iw + x0]!
    );
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const y0 = Math.max(0, y - radius);
      const x1 = Math.min(width, x + radius + 1);
      const y1 = Math.min(height, y + radius + 1);
      const count = (x1 - x0) * (y1 - y0);
      const mean = areaSum(x0, y0, x1, y1) / count;
      const v = gray[y * width + x]! < mean - 8 ? 0 : 255;
      const o = (y * width + x) * 4;
      src[o] = v;
      src[o + 1] = v;
      src[o + 2] = v;
    }
  }
}

/** One pass, in place on a copy. Image page stays the visual source of truth. */
export function enhanceImage(source: ImageData, preset: EnhancePreset): ImageData {
  const data = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  if (preset === "color") {
    autoLevels(data, 0.008);
    unsharp(data, 0.55, 1);
  } else if (preset === "whiteboard") {
    autoLevels(data, 0.004);
    whiteboard(data);
  } else if (preset === "receipt") {
    grayscaleContrast(data, 1.45, 8);
    unsharp(data, 0.85, 1);
  } else {
    adaptiveBw(data);
  }
  return data;
}
