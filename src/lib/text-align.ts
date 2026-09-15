/**
 * Group alignment for selected PDF text runs.
 *
 * Approach: align relative to the **selection bounding box**.
 * Left / Center / Right move each selected member so it shares that edge
 * of the box (right = shared right edge, which is what the tests lock).
 *
 * Statement columns stay sane when the user marquees *one column* (all the
 * amounts, or all the descriptions) and aligns that group. Marqueeing a
 * whole row then Align Right would stack description onto the balance —
 * Snap to original layout restores extract-time x,y for each member.
 *
 * Positions are written into the content stream on Apply/Export (`targetX`),
 * not only the overlay CSS.
 */
import type { TextLine } from "./pdf-runtime";
import { expandToFullLine } from "./pdf-runtime";
import type { TextPatch } from "./pdf-text-edit";
import { membersForLinePatch } from "./edit-apply";
import { coverBoxesFromLine } from "./text-select";

export type AlignKind = "left" | "center" | "right" | "justify";

export const ALIGN_SELECTION_LABEL = "Align selection";
export const SNAP_ORIGINAL_LABEL = "Snap to original layout";
export const ALIGN_HINT =
  "Aligns the selected runs to this group’s box. For statement columns, Select-any over one column, or snap back to the original PDF layout.";

export const POSITION_EPS = 0.05;

/**
 * PDF.js `y` vs content-stream `originY` (attachStreamHints) often differs by
 * a few points on CID/statement pages, and wrapped continuation rows can land
 * 20–40pt away from the nearest show. That is extract metadata, not a user
 * nudge — treating it as `isMoved` painted overlay labels on live glyphs.
 * Align/nudge only change x, so a generous Y band is safe.
 */
export const POSITION_Y_EXTRACT_EPS = 48;

export type OriginBox = {
  x: number;
  y: number;
};

export function extractOrigin(run: {
  x: number;
  y: number;
  originX?: number;
  originY?: number;
}): OriginBox {
  return { x: run.originX ?? run.x, y: run.originY ?? run.y };
}

export function positionMoved(
  run: { x: number; y: number; originX?: number; originY?: number },
  eps = POSITION_EPS,
): boolean {
  const origin = extractOrigin(run);
  if (Math.abs(run.x - origin.x) > eps) return true;
  return Math.abs(run.y - origin.y) > Math.max(eps, POSITION_Y_EXTRACT_EPS);
}

export function withExtractOrigin(line: TextLine): TextLine {
  const members = line.members?.map(withExtractOrigin);
  return {
    ...line,
    originX: line.originX ?? line.x,
    originY: line.originY ?? line.y,
    ...(members ? { members } : {}),
  };
}

export function selectionMembers(line: TextLine | undefined | null): TextLine[] {
  if (!line) return [];
  const members = line.members?.length ? line.members : [line];
  return members.map(withExtractOrigin);
}

export function selectionBounds(
  runs: Array<{ x: number; y: number; width: number; height: number }>,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  bottom: number;
  top: number;
} {
  if (runs.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0, left: 0, right: 0, bottom: 0, top: 0 };
  }
  const left = Math.min(...runs.map((run) => run.x));
  const right = Math.max(...runs.map((run) => run.x + run.width));
  const bottom = Math.min(...runs.map((run) => run.y));
  const top = Math.max(...runs.map((run) => run.y + run.height));
  return {
    x: left,
    y: bottom,
    width: right - left,
    height: top - bottom,
    left,
    right,
    bottom,
    top,
  };
}

export function alignRuns<T extends { id: string; x: number; width: number }>(
  runs: T[],
  kind: AlignKind,
): T[] {
  if (runs.length === 0) return [];
  const box = selectionBounds(runs.map((run) => ({ ...run, y: 0, height: 1 })));
  if (kind === "left") {
    return runs.map((run) => ({ ...run, x: box.left }));
  }
  if (kind === "right") {
    return runs.map((run) => ({ ...run, x: box.right - run.width }));
  }
  if (kind === "center") {
    return runs.map((run) => ({ ...run, x: box.left + (box.width - run.width) / 2 }));
  }
  if (runs.length === 1) {
    return runs.map((run) => ({ ...run, x: box.left }));
  }
  const ordered = [...runs].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const totalWidth = ordered.reduce((sum, run) => sum + run.width, 0);
  const gap = (box.width - totalWidth) / (ordered.length - 1);
  let cursor = box.left;
  const placed = new Map<string, number>();
  for (const run of ordered) {
    placed.set(run.id, cursor);
    cursor += run.width + gap;
  }
  return runs.map((run) => ({ ...run, x: placed.get(run.id) ?? run.x }));
}

export function nudgeRuns<T extends { x: number }>(runs: T[], dx: number, dy = 0): T[] {
  if (dx === 0 && dy === 0) return runs;
  return runs.map((run) => ({
    ...run,
    x: run.x + dx,
    ...("y" in run && typeof (run as { y?: number }).y === "number"
      ? { y: ((run as { y: number }).y ?? 0) + dy }
      : {}),
  }));
}

export function snapRunsToOrigin<
  T extends { x: number; y: number; originX?: number; originY?: number },
>(runs: T[]): T[] {
  return runs.map((run) => {
    const origin = extractOrigin(run);
    return { ...run, x: origin.x, y: origin.y };
  });
}

/** Rebuild a joined line’s box from member positions without changing its id. */
export function lineWithMemberPositions(line: TextLine, nextMembers: TextLine[]): TextLine {
  const byId = new Map(nextMembers.map((run) => [run.id, run]));
  const members = (line.members?.length ? line.members : [line]).map((member) => {
    const hit = byId.get(member.id);
    if (!hit) return member;
    return {
      ...member,
      x: hit.x,
      y: hit.y,
      originX: member.originX ?? hit.originX ?? member.x,
      originY: member.originY ?? hit.originY ?? member.y,
    };
  });
  const minX = Math.min(...members.map((run) => run.x));
  const minY = Math.min(...members.map((run) => run.y));
  const maxRight = Math.max(...members.map((run) => run.x + run.width));
  const maxTop = Math.max(...members.map((run) => run.y + run.height));
  const fontSize = Math.max(...members.map((run) => run.fontSize), line.fontSize);
  return {
    ...line,
    members,
    x: minX,
    y: minY,
    width: Math.max(maxRight - minX, fontSize * 0.6),
    height: Math.max(maxTop - minY, fontSize * 1.18),
    originX: line.originX ?? extractOrigin(line).x,
    originY: line.originY ?? extractOrigin(line).y,
  };
}

export function lineAtOrigin(line: TextLine): TextLine {
  const members = (line.members?.length ? line.members : [line]).map((member) => {
    const origin = extractOrigin(member);
    return { ...member, x: origin.x, y: origin.y };
  });
  const origin = extractOrigin(line);
  if (!line.members?.length) {
    return { ...line, x: origin.x, y: origin.y };
  }
  return lineWithMemberPositions({ ...line, x: origin.x, y: origin.y }, members);
}

export function remapLinePositions(lines: TextLine[], nextMembers: TextLine[]): TextLine[] {
  const byId = new Map(nextMembers.map((run) => [run.id, run]));
  return lines.map((line) => {
    const members = line.members?.length ? line.members : [line];
    const touched = members.some((member) => byId.has(member.id)) || byId.has(line.id);
    if (!touched) return line;
    const updatedMembers = members.map((member) => {
      const hit = byId.get(member.id);
      if (!hit) return member;
      return {
        ...member,
        x: hit.x,
        y: "y" in hit ? hit.y : member.y,
        originX: member.originX ?? hit.originX ?? member.x,
        originY: member.originY ?? hit.originY ?? member.y,
      };
    });
    if (line.members?.length) return lineWithMemberPositions(line, updatedMembers);
    const hit = byId.get(line.id) ?? updatedMembers[0];
    if (!hit) return line;
    return {
      ...line,
      x: hit.x,
      y: hit.y,
      originX: line.originX ?? hit.originX ?? line.x,
      originY: line.originY ?? hit.originY ?? line.y,
    };
  });
}

export type PositionEdit = {
  line: TextLine;
  text: string;
  fontChoiceId?: string;
  memberTexts?: Record<string, string>;
};

function memberBoxesForPatch(line: TextLine): TextPatch["memberBoxes"] {
  const runs = line.members?.length ? line.members : [];
  if (runs.length <= 1) return undefined;
  return runs.map((run) => {
    const origin = extractOrigin(run);
    return {
      x: origin.x,
      y: origin.y,
      width: run.width,
      height: run.height,
      ...(run.text ? { text: run.text } : {}),
    };
  });
}

function originCoverBoxes(line: TextLine): TextPatch["coverBoxes"] {
  const members = line.members?.length ? line.members : [line];
  if (members.length <= 1) return undefined;
  return members.map((run) => {
    const origin = extractOrigin(run);
    return {
      x: origin.x,
      y: origin.y,
      width: run.width,
      height: run.height,
    };
  });
}

function patchForRun(
  run: TextLine,
  text: string,
  extras: Pick<TextPatch, "fontChoice"> = {},
): TextPatch {
  const origin = extractOrigin(run);
  const moved = positionMoved({ ...run, originX: origin.x, originY: origin.y });
  const coverBoxes = originCoverBoxes(run) ?? coverBoxesFromLine(run);
  const memberBoxes = memberBoxesForPatch(run);
  return {
    page: run.page,
    x: origin.x,
    y: origin.y,
    width: run.width,
    height: run.height,
    fontSize: run.fontSize,
    text,
    originalText: run.text,
    ...(run.rawText ? { rawText: run.rawText } : {}),
    fontName: run.fontName,
    fontFamily: run.fontFamily,
    ...(memberBoxes ? { memberBoxes } : {}),
    ...(coverBoxes ? { coverBoxes } : {}),
    ...(moved ? { targetX: run.x, targetY: run.y } : {}),
    ...extras,
  };
}

/**
 * Build export/preview patches. When a multi-run group has been aligned,
 * emit one patch per moved member so each operator keeps its own x
 * (same spirit as column-locked rewrite). A joined text rewrite without
 * a move still uses a single patch so #31 marquee Apply stays intact.
 *
 * Locate uses extract-time origin (`x`); destination after align/nudge is
 * `targetX` / `targetY`. Column drafts from #32 ride along as `memberTexts`.
 */
export function patchesFromEdit(
  edit: PositionEdit,
  extras: Pick<TextPatch, "fontChoice"> = {},
): TextPatch[] {
  const line = withExtractOrigin(edit.line);
  const members = line.members?.length ? line.members : [line];
  const drafts =
    edit.memberTexts ?? (edit.text !== line.text ? { [line.id]: edit.text } : undefined);
  const segmented = membersForLinePatch(line, drafts);
  if (segmented?.length) {
    const changed = segmented.filter((member) => {
      const textChanged = (member.text ?? "") !== (member.originalText ?? "");
      const moved =
        (typeof member.targetX === "number" &&
          Math.abs(member.targetX - member.x) > POSITION_EPS) ||
        (typeof member.targetY === "number" && Math.abs(member.targetY - member.y) > POSITION_EPS);
      return textChanged || moved;
    });
    if (changed.length === 0) return [];
    return changed.map((member) => {
      const size = member.fontSize ?? line.fontSize;
      const width =
        member.width > 0
          ? member.width
          : Math.max(size * 0.6, (member.originalText || member.text || "").length * size * 0.5);
      const memberRaw = member.rawText?.trim();
      const lineRaw = line.rawText?.trim();
      const needle = (member.originalText ?? member.text ?? "").trim();
      const rawText =
        memberRaw ||
        (lineRaw && needle && lineRaw.replace(/\s+/g, "") === needle.replace(/\s+/g, "")
          ? lineRaw
          : undefined);
      return {
        page: line.page,
        x: member.x,
        y: member.y,
        width,
        height: member.height || line.height,
        fontSize: size,
        text: member.text,
        originalText: member.originalText ?? member.text,
        ...(rawText ? { rawText } : {}),
        fontName: member.fontName ?? line.fontName,
        fontFamily: member.fontFamily ?? line.fontFamily,
        ...(typeof member.targetX === "number" ? { targetX: member.targetX } : {}),
        ...(typeof member.targetY === "number" ? { targetY: member.targetY } : {}),
        ...extras,
      };
    });
  }
  const textChanged = edit.text.trim() !== line.text;
  const movedMembers = members.filter((member) => positionMoved(member));

  if (members.length > 1 && movedMembers.length > 0) {
    return movedMembers.map((member) => patchForRun(member, member.text, extras));
  }
  if (!textChanged && movedMembers.length === 0 && !positionMoved(line)) return [];
  return [patchForRun(line, edit.text, extras)];
}

export function editIsPending(edit: PositionEdit): boolean {
  const line = withExtractOrigin(edit.line);
  const members = line.members?.length ? line.members : [line];
  if (edit.text.trim() !== line.text) return true;
  if (edit.memberTexts) {
    for (const [id, text] of Object.entries(edit.memberTexts)) {
      const member = members.find((run) => run.id === id);
      if (member && text.trim() !== member.text.trim()) return true;
    }
  }
  return members.some((member) => positionMoved(member)) || positionMoved(line);
}

export function groupForAlign(selected: TextLine, lines: TextLine[]): TextLine[] {
  const members = selectionMembers(selected);
  if (members.length >= 2) return members;
  const expanded = expandToFullLine(lines, selected);
  if (expanded?.members && expanded.members.length >= 2) return selectionMembers(expanded);
  return members;
}

export function showAlignControls(input: {
  selected: TextLine | undefined;
  lines?: TextLine[];
  textSelectMode: "line" | "marquee";
}): boolean {
  if (!input.selected) return false;
  const members = groupForAlign(input.selected, input.lines ?? []);
  if (members.length >= 2) return true;
  return input.textSelectMode === "marquee";
}
