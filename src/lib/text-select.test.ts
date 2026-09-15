import { describe, expect, it } from "vitest";
import {
  groupTextItems,
  mergeLinesByBaseline,
  type RawTextItem,
  type TextLine,
} from "./pdf-runtime";
import {
  applyMarqueeToLines,
  coverBoxesFromLine,
  joinRunsInReadingOrder,
  selectRunsIntersectingRect,
} from "./text-select";
import {
  chunkRowsForSelection,
  columnFieldsForLine,
  membersForLinePatch,
  selectionEditTitle,
} from "./edit-apply";

function item(str: string, x: number, w: number, fontName = "F1", y = 400): RawTextItem {
  return { str, x, y, w, h: 9, fontName, fontFamily: "Helvetica" };
}

function run(partial: Partial<TextLine> & Pick<TextLine, "id" | "text" | "x">): TextLine {
  return {
    page: 1,
    y: 400,
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

describe("marquee text select", () => {
  it("selects every intersecting run, not only one pre-grouped line", () => {
    const runs = groupTextItems(
      [
        item("06-08", 56, 28),
        item("Paid To -", 90, 44),
        item("Synchrony card", 140, 72),
        item("Syd Pay", 218, 40),
        item("500.00", 500, 36, "F2"),
      ],
      1,
    );
    const lines = mergeLinesByBaseline(runs);
    expect(lines.length).toBeGreaterThan(1);
    const label = lines.find((line) => line.text.includes("Synchrony"));
    const amount = lines.find((line) => line.text.includes("500.00"));
    expect(label).toBeTruthy();
    expect(amount).toBeTruthy();

    const marquee = selectRunsIntersectingRect(lines, {
      x: 50,
      y: 395,
      width: 500,
      height: 20,
    });
    expect(marquee.length).toBeGreaterThan(1);
    const joined = joinRunsInReadingOrder(marquee);
    expect(joined.text).toMatch(/Synchrony/);
    expect(joined.text).toMatch(/500\.00/);
    expect(joined.members?.length).toBeGreaterThan(1);
    expect(coverBoxesFromLine(joined)?.length).toBeGreaterThan(1);
  });

  it("keeps a gap column out when the marquee misses it", () => {
    const lines = mergeLinesByBaseline(
      groupTextItems([item("Total due", 40, 50), item("1,987.00", 400, 44, "F2")], 1),
    );
    const hits = selectRunsIntersectingRect(lines, { x: 30, y: 395, width: 80, height: 18 });
    const joined = joinRunsInReadingOrder(hits);
    expect(joined.text).toMatch(/Total due/);
    expect(joined.text).not.toMatch(/1,987/);
  });

  it("splits leftover members when only some runs are marqueed", () => {
    const lines: TextLine[] = [
      joinRunsInReadingOrder([
        run({ id: "a", text: "Paid To", x: 50, width: 60 }),
        run({ id: "b", text: "Synchrony", x: 120, width: 80 }),
      ]),
      run({ id: "c", text: "500.00", x: 420, width: 40, fontName: "F2" }),
    ];
    const { lines: next, joined } = applyMarqueeToLines(lines, {
      x: 110,
      y: 395,
      width: 360,
      height: 18,
    });
    expect(joined?.text).toMatch(/Synchrony/);
    expect(joined?.text).toMatch(/500\.00/);
    expect(next.some((line) => line.text === "Paid To")).toBe(true);
    expect(next.some((line) => line.id === joined?.id)).toBe(true);
  });

  it("marquee across two statement rows produces per-row drafts, not mashed amounts", () => {
    const row = (y: number, desc: string, amt: string, bal: string, key: string): TextLine[] => [
      run({ id: `${key}-desc`, text: desc, x: 14, width: 280, y, originY: y, fontSize: 8 }),
      run({
        id: `${key}-amt`,
        text: amt,
        x: 409,
        width: 48,
        y,
        originY: y,
        fontSize: 8,
        fontName: "F2",
      }),
      run({
        id: `${key}-bal`,
        text: bal,
        x: 517,
        width: 48,
        y,
        originY: y,
        fontSize: 8,
        fontName: "F2",
      }),
    ];
    const lines = [
      joinRunsInReadingOrder(
        row(400, "06-08 Paid To - Synchrony card Syd Pay", "500.00", "4,972.29", "r1"),
      ),
      joinRunsInReadingOrder(
        row(380, "06-09 Paid To - Applecard Payment", "250.00", "1,834.34", "r2"),
      ),
    ];
    const { joined } = applyMarqueeToLines(lines, { x: 10, y: 370, width: 560, height: 50 });
    expect(joined).toBeTruthy();
    expect(columnFieldsForLine(joined!)).toEqual([]);

    const chunks = chunkRowsForSelection(joined!);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.fields.map((field) => field.label))).toEqual([
      ["Description", "Amount", "Balance"],
      ["Description", "Amount", "Balance"],
    ]);
    expect(chunks[0]?.fields.map((field) => field.text)).toEqual([
      "06-08 Paid To - Synchrony card Syd Pay",
      "500.00",
      "4,972.29",
    ]);
    expect(chunks[1]?.fields.map((field) => field.text)).toEqual([
      "06-09 Paid To - Applecard Payment",
      "250.00",
      "1,834.34",
    ]);
    const mashed = chunks
      .flatMap((chunk) => chunk.fields)
      .some((field) => /\d\s+\d/.test(field.text));
    expect(mashed).toBe(false);
    expect(
      chunks.some((chunk) => chunk.fields.some((field) => field.label === "Amount / Balance")),
    ).toBe(false);

    const descId = chunks[0]?.fields.find((field) => field.label === "Description")?.id;
    const members = membersForLinePatch(joined!, {
      [descId!]: "06-08 Paid From - Synchrony card Syd Pay",
    });
    expect(members?.find((member) => member.originalText === "500.00")).toMatchObject({
      text: "500.00",
      x: 409,
    });
    expect(members?.find((member) => member.originalText === "250.00")).toMatchObject({
      text: "250.00",
      x: 409,
    });
    expect(members?.find((member) => member.originalText === "4,972.29")?.x).toBe(517);
    expect(members?.find((member) => member.originalText === "1,834.34")?.x).toBe(517);
    expect(selectionEditTitle({ rowCount: chunks.length, runCount: 6 })).toBe(
      "Editing 2 lines / 6 runs",
    );
  });
});
