import { describe, expect, it } from "vitest";
import type { TextLine } from "./pdf-runtime";
import {
  ALIGN_SELECTION_LABEL,
  SNAP_ORIGINAL_LABEL,
  alignRuns,
  editIsPending,
  extractOrigin,
  lineWithMemberPositions,
  nudgeRuns,
  patchesFromEdit,
  positionMoved,
  remapLinePositions,
  selectionBounds,
  showAlignControls,
  snapRunsToOrigin,
} from "./text-align";

function run(partial: Partial<TextLine> & Pick<TextLine, "id" | "text" | "x">): TextLine {
  const x = partial.x;
  const y = partial.y ?? 400;
  return {
    page: 1,
    y,
    originX: partial.originX ?? x,
    originY: partial.originY ?? y,
    width: 40,
    height: 12,
    fontSize: 11,
    fontName: "F1",
    fontFamily: "Helvetica",
    kind: "run",
    source: "pdfjs",
    hasTextOperator: true,
    ...partial,
  };
}

describe("group align against the selection box", () => {
  it("Align Right moves three runs at different x to a shared right edge", () => {
    const runs = [
      run({ id: "a", text: "Paid To", x: 50, width: 60 }),
      run({ id: "b", text: "500.00", x: 400, width: 40 }),
      run({ id: "c", text: "1,200.00", x: 500, width: 50 }),
    ];
    const box = selectionBounds(runs);
    expect(box.right).toBeCloseTo(550);
    const aligned = alignRuns(runs, "right");
    expect(aligned.map((item) => item.x + item.width)).toEqual([550, 550, 550]);
    expect(aligned[0]?.x).toBeCloseTo(490);
    expect(aligned[1]?.x).toBeCloseTo(510);
    expect(aligned[2]?.x).toBeCloseTo(500);
  });

  it("Align Left / Center share the selection box, Justify spreads first and last", () => {
    const runs = [
      run({ id: "a", text: "A", x: 50, width: 20 }),
      run({ id: "b", text: "B", x: 120, width: 20 }),
      run({ id: "c", text: "C", x: 200, width: 20 }),
    ];
    const left = alignRuns(runs, "left");
    expect(left.every((item) => item.x === 50)).toBe(true);
    const center = alignRuns(runs, "center");
    expect(center.every((item) => Math.abs(item.x + item.width / 2 - 135) < 0.01)).toBe(true);
    const justified = alignRuns(runs, "justify");
    expect(justified[0]?.x).toBeCloseTo(50);
    expect(justified[2]?.x).toBeCloseTo(200);
  });

  it("Snap restores extract-time xs after a right-align", () => {
    const runs = [
      run({ id: "a", text: "Paid To", x: 50, width: 60, originX: 50, originY: 400 }),
      run({ id: "b", text: "500.00", x: 400, width: 40, originX: 400, originY: 400 }),
      run({ id: "c", text: "1,200.00", x: 500, width: 50, originX: 500, originY: 400 }),
    ];
    const originals = runs.map((item) => item.x);
    const aligned = alignRuns(runs, "right");
    const rights = aligned.map((item) => item.x + item.width);
    expect(Math.max(...rights) - Math.min(...rights)).toBeLessThan(0.01);
    expect(aligned.some((item) => positionMoved(item))).toBe(true);
    const snapped = snapRunsToOrigin(aligned);
    expect(snapped.map((item) => item.x)).toEqual(originals);
    expect(snapped.every((item) => !positionMoved(item))).toBe(true);
  });

  it("does not treat extract-time PDF.js vs stream Y drift as a user move", () => {
    const member = run({
      id: "desc",
      text: "06-06 POS Debit Debit Card 6205",
      x: 14,
      y: 695.2,
      originX: 14,
      originY: 700,
    });
    expect(positionMoved(member)).toBe(false);
    const wrapped = run({
      id: "wrap",
      text: "Amzn Mktp Us zl4Fa Amzn.Com/Bill",
      x: 56,
      y: 500,
      originX: 56,
      originY: 535.76,
    });
    expect(positionMoved(wrapped)).toBe(false);
  });

  it("is a no-op for position when text was edited but not moved", () => {
    const member = run({ id: "a", text: "Paid To", x: 50, originX: 50, originY: 400 });
    expect(positionMoved(member)).toBe(false);
    expect(editIsPending({ line: member, text: "Paid From" })).toBe(true);
    expect(editIsPending({ line: member, text: "Paid To" })).toBe(false);
  });

  it("nudge shifts x by 1pt and 5pt", () => {
    const runs = [run({ id: "a", text: "A", x: 50 })];
    expect(nudgeRuns(runs, 1)[0]?.x).toBeCloseTo(51);
    expect(nudgeRuns(runs, -5)[0]?.x).toBeCloseTo(45);
  });

  it("remap keeps the parent line id while members move", () => {
    const parent = run({
      id: "row",
      text: "Paid To 500.00",
      x: 50,
      width: 390,
      members: [
        run({ id: "a", text: "Paid To", x: 50, width: 60 }),
        run({ id: "b", text: "500.00", x: 400, width: 40 }),
      ],
    });
    const aligned = alignRuns(parent.members!, "right");
    const [next] = remapLinePositions([parent], aligned);
    expect(next?.id).toBe("row");
    expect(next?.members?.map((item) => item.x + item.width)).toEqual([440, 440]);
  });

  it("patchesFromEdit emits per-member targetX so columns keep their own operators", () => {
    const a = run({ id: "a", text: "Paid To", x: 50, width: 60, originX: 50 });
    const b = run({ id: "b", text: "500.00", x: 400, width: 40, originX: 400 });
    const line = lineWithMemberPositions(
      run({
        id: "row",
        text: "Paid To 500.00",
        x: 50,
        width: 390,
        originX: 50,
        members: [a, b],
      }),
      alignRuns([a, b], "right"),
    );
    const patches = patchesFromEdit({ line, text: line.text });
    expect(patches.length).toBeGreaterThanOrEqual(1);
    expect(patches.every((patch) => typeof patch.targetX === "number")).toBe(true);
    expect(patches.every((patch) => patch.x === 50 || patch.x === 400)).toBe(true);
    expect(patches.every((patch) => patch.text === patch.originalText)).toBe(true);
    const alignedRights = line.members!.map((item) => item.x + item.width);
    expect(Math.max(...alignedRights) - Math.min(...alignedRights)).toBeLessThan(0.01);
  });

  it("patchesFromEdit keeps amount locate-x when description text and overlay x both change", () => {
    const desc = run({ id: "a", text: "Paid To", x: 490, width: 60, originX: 50 });
    const amt = run({ id: "b", text: "500.00", x: 400, width: 40, originX: 400 });
    const line = run({
      id: "row",
      text: "Paid To 500.00",
      x: 400,
      width: 150,
      originX: 50,
      members: [desc, amt],
    });
    const patches = patchesFromEdit({
      line,
      text: "Paid From 500.00",
      memberTexts: { a: "Paid From", b: "500.00" },
    });
    const descPatch = patches.find((patch) => patch.originalText === "Paid To");
    const amtPatch = patches.find((patch) => patch.originalText === "500.00");
    expect(descPatch?.x).toBe(50);
    expect(descPatch?.targetX).toBe(490);
    expect(descPatch?.text).toBe("Paid From");
    expect(amtPatch).toBeUndefined();
  });

  it("patchesFromEdit does not copy joined-row rawText onto a description-only patch", () => {
    const desc = "05-22 Paid To - Applecard Gsbank Payment Chk 12408508";
    const line = run({
      id: "row",
      text: `${desc} 250.00- 1,834.34`,
      rawText: `${desc}250.00-1,834.34`,
      x: 14,
      width: 547,
      originX: 14,
      members: [
        run({ id: "desc", text: desc, x: 14, width: 500, originX: 14 }),
        run({ id: "amt", text: "250.00-", x: 409, width: 40, originX: 409 }),
        run({ id: "bal", text: "1,834.34", x: 517, width: 44, originX: 517 }),
      ],
    });
    const patches = patchesFromEdit({
      line,
      text: `${desc.replace("Paid To", "Paid From")} 250.00- 1,834.34`,
      memberTexts: { desc: desc.replace("Paid To", "Paid From") },
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]?.originalText).toBe(desc);
    expect(patches[0]?.text).toMatch(/Paid From/);
    expect(patches[0]?.rawText).toBeUndefined();
    expect(patches[0]?.width).toBe(500);
    expect(patches.some((patch) => /250\.00/.test(patch.originalText ?? ""))).toBe(false);
  });

  it("shows align controls for a multi-run selection or after a marquee", () => {
    expect(ALIGN_SELECTION_LABEL).toMatch(/Align selection/);
    expect(SNAP_ORIGINAL_LABEL).toMatch(/Snap to original layout/);
    const joined = run({
      id: "row",
      text: "A B",
      x: 50,
      members: [run({ id: "a", text: "A", x: 50 }), run({ id: "b", text: "B", x: 120 })],
    });
    expect(showAlignControls({ selected: joined, textSelectMode: "line" })).toBe(true);
    expect(
      showAlignControls({
        selected: run({ id: "a", text: "A", x: 50 }),
        textSelectMode: "line",
      }),
    ).toBe(false);
    expect(
      showAlignControls({
        selected: run({ id: "a", text: "A", x: 50 }),
        textSelectMode: "marquee",
      }),
    ).toBe(true);
  });

  it("extractOrigin falls back to current x when origin was never stamped", () => {
    expect(extractOrigin({ x: 12, y: 40 })).toEqual({ x: 12, y: 40 });
  });
});
