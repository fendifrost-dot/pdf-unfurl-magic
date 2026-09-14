/** Pure geometry for document quads and perspective warps. No DOM. */

export type Point = { x: number; y: number };
/** Top-left, top-right, bottom-right, bottom-left in image space. */
export type Quad = [Point, Point, Point, Point];

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: clamp(point.x, 0, Math.max(0, width - 1)),
    y: clamp(point.y, 0, Math.max(0, height - 1)),
  };
}

export function clampQuad(quad: Quad, width: number, height: number): Quad {
  return [
    clampPoint(quad[0], width, height),
    clampPoint(quad[1], width, height),
    clampPoint(quad[2], width, height),
    clampPoint(quad[3], width, height),
  ];
}

export function insetQuad(width: number, height: number, margin = 0.06): Quad {
  const mx = width * margin;
  const my = height * margin;
  return [
    { x: mx, y: my },
    { x: width - mx, y: my },
    { x: width - mx, y: height - my },
    { x: mx, y: height - my },
  ];
}

/** Order four corners as TL, TR, BR, BL. */
export function orderQuad(points: Point[]): Quad {
  if (points.length !== 4) {
    throw new Error("A document outline needs exactly four corners.");
  }
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  let tl = pts[0]!;
  let tr = pts[0]!;
  let br = pts[0]!;
  let bl = pts[0]!;
  for (const p of pts) {
    if (p.x + p.y < tl.x + tl.y) tl = p;
    if (p.x + p.y > br.x + br.y) br = p;
    if (p.x - p.y > tr.x - tr.y) tr = p;
    if (p.y - p.x > bl.y - bl.x) bl = p;
  }
  return [tl, tr, br, bl];
}

export function quadArea(quad: Quad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

export function scaleQuad(quad: Quad, sx: number, sy: number = sx): Quad {
  return [
    { x: quad[0].x * sx, y: quad[0].y * sy },
    { x: quad[1].x * sx, y: quad[1].y * sy },
    { x: quad[2].x * sx, y: quad[2].y * sy },
    { x: quad[3].x * sx, y: quad[3].y * sy },
  ];
}

export function sideLengths(quad: Quad): [number, number, number, number] {
  return [
    dist(quad[0], quad[1]),
    dist(quad[1], quad[2]),
    dist(quad[2], quad[3]),
    dist(quad[3], quad[0]),
  ];
}

/** How close a quad is to a rectangle (1 = perfect). */
export function rectangularity(quad: Quad): number {
  const [top, right, bottom, left] = sideLengths(quad);
  const hPair = 1 - Math.abs(top - bottom) / Math.max(top, bottom, 1);
  const vPair = 1 - Math.abs(left - right) / Math.max(left, right, 1);
  let angle = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[(i + 3) % 4]!;
    const b = quad[i]!;
    const c = quad[(i + 1) % 4]!;
    const v1x = a.x - b.x;
    const v1y = a.y - b.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    const cos = d === 0 ? 0 : (v1x * v2x + v1y * v2y) / d;
    angle += 1 - Math.abs(cos);
  }
  return clamp((hPair + vPair + angle / 4) / 3, 0, 1);
}

export function outputSizeForQuad(quad: Quad, maxEdge = 1800): { width: number; height: number } {
  const [top, right, bottom, left] = sideLengths(quad);
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  if (width < 8 || height < 8) return { width: 8, height: 8 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(32, Math.round(width * scale)),
    height: Math.max(32, Math.round(height * scale)),
  };
}

/** 3×3 row-major. h8 is 1 after solving. */
export function solveHomography(src: Quad, dst: Quad): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const s = src[i]!;
    const d = dst[i]!;
    A.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    b.push(d.x);
    A.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    b.push(d.y);
  }
  const h = solveLinearSystem(A, b);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function applyHomography(H: number[], point: Point): Point {
  const w = H[6]! * point.x + H[7]! * point.y + H[8]!;
  const inv = w === 0 ? 0 : 1 / w;
  return {
    x: (H[0]! * point.x + H[1]! * point.y + H[2]!) * inv,
    y: (H[3]! * point.x + H[4]! * point.y + H[5]!) * inv,
  };
}

export function invertHomography(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e! * i! - f! * h!;
  const B = c! * h! - b! * i!;
  const C = b! * f! - c! * e!;
  const D = f! * g! - d! * i!;
  const E = a! * i! - c! * g!;
  const F = c! * d! - a! * f!;
  const G = d! * h! - e! * g!;
  const Hh = b! * g! - a! * h!;
  const I = a! * e! - b! * d!;
  const det = a! * A + b! * D + c! * G;
  if (Math.abs(det) < 1e-12) {
    throw new Error("Could not invert the page transform.");
  }
  const s = 1 / det;
  return [A * s, B * s, C * s, D * s, E * s, F * s, G * s, Hh * s, I * s];
}

export function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const n = values.length;
  const m = matrix.map((row, i) => [...row, values[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    const swap = m[col]!;
    m[col] = m[pivot]!;
    m[pivot] = swap;
    const diag = m[col]![col]!;
    if (Math.abs(diag) < 1e-12) {
      throw new Error("Could not solve the page transform.");
    }
    for (let c = col; c <= n; c++) m[col]![c]! /= diag;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]!;
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  return m.map((row) => row[n]!);
}

export function convexHull(points: Point[]): Point[] {
  const unique = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (unique.length <= 2) return unique;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function ramerDouglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points.slice();
  let maxDist = 0;
  let index = 0;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i]!, start, end);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const right = ramerDouglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}

function pointLineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return dist(p, a);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
}

/** Always returns four corners from a convex hull (rotating-calipers style). */
export function minAreaRect(hull: Point[]): Quad {
  if (hull.length === 0) return insetQuad(1, 1);
  if (hull.length < 3) {
    const xs = hull.map((p) => p.x);
    const ys = hull.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return orderQuad([
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ]);
  }
  let bestArea = Infinity;
  let best: Quad | null = null;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % n]!;
    const edgeX = b.x - a.x;
    const edgeY = b.y - a.y;
    const len = Math.hypot(edgeX, edgeY) || 1;
    const ux = edgeX / len;
    const uy = edgeY / len;
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const du = (p.x - a.x) * ux + (p.y - a.y) * uy;
      const dv = (p.x - a.x) * vx + (p.y - a.y) * vy;
      if (du < minU) minU = du;
      if (du > maxU) maxU = du;
      if (dv < minV) minV = dv;
      if (dv > maxV) maxV = dv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      best = orderQuad([
        { x: a.x + ux * minU + vx * minV, y: a.y + uy * minU + vy * minV },
        { x: a.x + ux * maxU + vx * minV, y: a.y + uy * maxU + vy * minV },
        { x: a.x + ux * maxU + vx * maxV, y: a.y + uy * maxU + vy * maxV },
        { x: a.x + ux * minU + vx * maxV, y: a.y + uy * minU + vy * maxV },
      ]);
    }
  }
  return best ?? insetQuad(1, 1);
}

export function approxQuadFromHull(hull: Point[]): Quad {
  if (hull.length < 3) return minAreaRect(hull);
  const closed = hull[0] === hull[hull.length - 1] ? hull : [...hull, hull[0]!];
  let lo = 0.5;
  let hi = 80;
  let four: Point[] | null = null;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const approx = ramerDouglasPeucker(closed, mid);
    const pts =
      approx[0] && approx[approx.length - 1] && dist(approx[0], approx[approx.length - 1]!) < 2
        ? approx.slice(0, -1)
        : approx;
    if (pts.length > 4) lo = mid;
    else {
      if (pts.length === 4) four = pts;
      hi = mid;
    }
  }
  if (four && four.length === 4) return orderQuad(four);
  return minAreaRect(hull);
}
