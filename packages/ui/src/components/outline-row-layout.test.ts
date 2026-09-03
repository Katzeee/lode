import { describe, expect, it } from "vitest";

import { groupOutlineRows, projectEmptyChildRows, type OutlineRowLayout } from "./outline-row-layout.js";
import { flattenOutline, type OutlineOccurrence } from "./outline-tree-model.js";

type Value = Readonly<{ layout: OutlineRowLayout }>;
const node = (
  id: string,
  layout: OutlineRowLayout,
  children?: readonly OutlineOccurrence<Value>[],
): OutlineOccurrence<Value> => ({ children, nodeId: id, occurrenceId: id, value: { layout } });

describe("groupOutlineRows", () => {
  it("pairs a trailing projection with the preceding leading entry while preserving logical rows", () => {
    const leading = { column: "leading" } as const;
    const paired = { column: "trailing", indentDepth: 0, pairWithPrevious: true } as const;
    const trailing = { column: "trailing", indentDepth: 0 } as const;
    const rows = flattenOutline(
      [{ ...node("relation", leading, [node("first", paired), node("second", trailing)]), expandable: false }],
      new Set(),
    );
    const visualRows = groupOutlineRows(rows, (row) => row.occurrence.value.layout);

    expect(visualRows.map((visualRow) => visualRow.entries.map((entry) => entry.row.key))).toEqual([
      ["relation", "relation/first"],
      ["relation/second"],
    ]);
    expect(visualRows.flatMap((visualRow) => visualRow.entries).map((entry) => entry.index)).toEqual([0, 1, 2]);
  });

  it("keeps local indentation and column projection entirely consumer-defined", () => {
    const rows = flattenOutline(
      [node("root", {}, [node("child", { column: "trailing", indentDepth: 0 }, [node("nested", {})])])],
      new Set(["root", "root/child"]),
    );
    const entries = groupOutlineRows(rows, (row) => row.occurrence.value.layout).flatMap(
      (visualRow) => visualRow.entries,
    );

    expect(entries.map(({ layout, row }) => [row.key, layout.column ?? "single", layout.indentDepth])).toEqual([
      ["root", "single", undefined],
      ["root/child", "trailing", 0],
      ["root/child/nested", "single", undefined],
    ]);
  });

  it("projects an expanded empty child as UI state without inventing an Occurrence", () => {
    const rows = flattenOutline([node("empty", { column: "trailing", indentDepth: 0 })], new Set(["empty"]));
    const grouped = groupOutlineRows(rows, (row) => row.occurrence.value.layout);
    const rendered = projectEmptyChildRows(grouped, true);

    expect(rows).toHaveLength(1);
    expect(rendered).toMatchObject([
      { kind: "nodes" },
      {
        key: "empty/::empty-child",
        kind: "empty-child",
        layout: { column: "trailing", indentDepth: 1 },
        parent: { key: "empty" },
      },
    ]);
  });
});
