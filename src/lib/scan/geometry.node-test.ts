import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyHomography,
  invertHomography,
  orderQuad,
  outputSizeForQuad,
  quadArea,
  rectangularity,
  solveHomography,
  type Quad,
} from "./geometry.ts";

test("orderQuad puts corners in TL TR BR BL", () => {
  const ordered = orderQuad([
    { x: 80, y: 90 },
    { x: 10, y: 12 },
    { x: 12, y: 88 },
    { x: 84, y: 8 },
  ]);
  assert.equal(Math.round(ordered[0].x), 10);
  assert.equal(Math.round(ordered[1].x), 84);
  assert.equal(Math.round(ordered[2].x), 80);
  assert.equal(Math.round(ordered[3].x), 12);
});

test("homography maps a quad onto a rectangle and back", () => {
  const src: Quad = [
    { x: 20, y: 10 },
    { x: 180, y: 30 },
    { x: 160, y: 220 },
    { x: 10, y: 200 },
  ];
  const dst: Quad = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 140 },
    { x: 0, y: 140 },
  ];
  const H = solveHomography(src, dst);
  for (let i = 0; i < 4; i++) {
    const mapped = applyHomography(H, src[i]!);
    assert.ok(Math.abs(mapped.x - dst[i]!.x) < 1e-6);
    assert.ok(Math.abs(mapped.y - dst[i]!.y) < 1e-6);
  }
  const inv = invertHomography(H);
  const back = applyHomography(inv, dst[2]);
  assert.ok(Math.abs(back.x - src[2].x) < 1e-6);
  assert.ok(Math.abs(back.y - src[2].y) < 1e-6);
});

test("a rectangle scores as rectangular and has positive area", () => {
  const quad: Quad = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ];
  assert.equal(quadArea(quad), 20000);
  assert.ok(rectangularity(quad) > 0.95);
  const size = outputSizeForQuad(quad, 1800);
  assert.equal(size.width, 100);
  assert.equal(size.height, 200);
});
