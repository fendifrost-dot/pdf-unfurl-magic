/**
 * Freeform / marquee text selection.
 *
 * Line mode still clicks one pre-grouped row. Select-any drags a rectangle
 * (PDF user space, origin bottom-left) and takes every intersecting *run*,
 * including amount columns that stay split from their labels.
 */
import { joinRunsToLine, type TextLine } from "./pdf-runtime";

export type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextSelectMode = "line" | "marquee";

const POINT_SIZE = 4;

export function flattenRuns(lines: TextLine[]): TextLine[] {
  const out: TextLine[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const members = line.members?.length ? line.members : [line];
    for (const run of members) {
      if (seen.has(run.id)) continue;
      seen.add(run.id);
      out.push(run);
    }
  }
  return out;
}

export function lineToRect(line: Pick<TextLine, "x" | "y" | "width" | "height">): PdfRect {
  return { x: line.x, y: line.y, width: line.width, height: line.height };
}

export function normalizeRect(rect: PdfRect): PdfRect {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

export function isPointSelect(rect: PdfRect): boolean {
  const box = normalizeRect(rect);
  return box.width < POINT_SIZE && box.height < POINT_SIZE;
}

export function rectsIntersect(a: PdfRect, b: PdfRect): boolean {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y, b.y);
  const top = Math.min(a.y + a.height, b.y + b.height);
  return right > left && top > bottom;
}

export function rectContainsPoint(rect: PdfRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Operator boxes covered by a multi-run selection — not the union gutter. */
export function coverBoxesFromLine(
  line: TextLine,
): Array<{ x: number; y: number; width: number; height: number }> | undefined {
  const members = line.members?.length ? line.members : [line];
  if (members.length <= 1) return undefined;
  return members.map((run) => ({
    x: run.x,
    y: run.y,
    width: run.width,
    height: run.height,
  }));
}

export function selectRunsIntersectingRect(lines: TextLine[], rect: PdfRect): TextLine[] {
  const box = normalizeRect(rect);
  if (box.width <= 0 && box.height <= 0) return [];
  const hits = flattenRuns(lines).filter((run) => rectsIntersect(lineToRect(run), box));
  return hits.sort((a, b) => b.y - a.y || a.x - b.x);
}

export function selectRunAtPoint(lines: TextLine[], x: number, y: number): TextLine | null {
  const hits = flattenRuns(lines).filter((run) => rectContainsPoint(lineToRect(run), x, y));
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.width * a.height - b.width * b.height);
  return hits[0] ?? null;
}

function baselineBand(runs: TextLine[]): TextLine[][] {
  if (runs.length === 0) return [];
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const bands: TextLine[][] = [];
  for (const run of sorted) {
    const band = bands[bands.length - 1];
    const anchor = band?.[0];
    const yTol = Math.max(3, Math.max(run.fontSize, anchor?.fontSize ?? run.fontSize) * 0.5);
    if (band && anchor && Math.abs(anchor.y - run.y) <= yTol) band.push(run);
    else bands.push([run]);
  }
  return bands;
}

/** Merge hit runs into one draft in reading order (top→bottom, then left→right). */
export function joinRunsInReadingOrder(runs: TextLine[]): TextLine {
  if (runs.length === 0) {
    return joinRunsToLine([]);
  }
  if (runs.length === 1) {
    const only = runs[0]!;
    return {
      ...only,
      kind: "line",
      members: only.members?.length ? only.members : [only],
    };
  }
  const bands = baselineBand(runs);
  const rowLines = bands.map((band) => joinRunsToLine(band));
  const first = rowLines[0] ?? joinRunsToLine(runs);
  const members = runs.flatMap((run) => (run.members?.length ? run.members : [run]));
  const minX = Math.min(...members.map((run) => run.x));
  const minY = Math.min(...members.map((run) => run.y));
  const maxRight = Math.max(...members.map((run) => run.x + run.width));
  const maxTop = Math.max(...members.map((run) => run.y + run.height));
  const fontSize = Math.max(...members.map((run) => run.fontSize));
  const text = rowLines
    .map((row) => row.text)
    .join(rowLines.length > 1 ? "\n" : " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  const rawParts = members.map((run) => run.rawText ?? run.text);
  const rawJoined = rawParts
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
  const confidences = members
    .map((run) => run.confidence)
    .filter((value): value is number => typeof value === "number");
  return {
    id: `p${first.page}-m${Math.round(minX)}-${Math.round(minY)}-${Math.round(maxRight)}`,
    page: first.page,
    text,
    ...(rawJoined && rawJoined !== text.replace(/\s+/g, " ").trim() ? { rawText: rawJoined } : {}),
    x: minX,
    y: minY,
    width: Math.max(maxRight - minX, fontSize * 0.6),
    height: Math.max(maxTop - minY, fontSize * 1.18),
    fontSize,
    fontName: first.fontName,
    fontFamily: first.fontFamily,
    source: first.source,
    hasTextOperator: members.some((run) => run.hasTextOperator !== false),
    kind: "line",
    members,
    ...(confidences.length
      ? { confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length }
      : {}),
  };
}

/**
 * Replace hit runs with one joined draft. Uncovered siblings of a split line
 * stay as their own row so Apply only rewrites the marquee members.
 */
export function applyMarqueeToLines(
  lines: TextLine[],
  rect: PdfRect,
): { lines: TextLine[]; joined: TextLine | null } {
  const box = normalizeRect(rect);
  const hit = isPointSelect(box)
    ? (() => {
        const run = selectRunAtPoint(lines, box.x, box.y);
        return run ? [run] : [];
      })()
    : selectRunsIntersectingRect(lines, box);
  if (hit.length === 0) return { lines, joined: null };

  const hitIds = new Set(
    hit.flatMap((run) => (run.members?.length ? run.members : [run]).map((item) => item.id)),
  );
  const leftover: TextLine[] = [];
  for (const line of lines) {
    const members = line.members?.length ? line.members : [line];
    const kept = members.filter((member) => !hitIds.has(member.id));
    if (kept.length === members.length) leftover.push(line);
    else if (kept.length === 1) leftover.push({ ...kept[0]!, kind: "line", members: kept });
    else if (kept.length > 1) leftover.push(joinRunsInReadingOrder(kept));
  }
  const joined = joinRunsInReadingOrder(hit);
  const next = [...leftover, joined].sort((a, b) => b.y - a.y || a.x - b.x);
  return { lines: next, joined };
}
