import type { OutlineRow } from "./outline-tree-model.js";

export type OutlineRowLayout = Readonly<{
  /** Places related entries in a shared two-column visual row without changing their tree relationship. */
  column?: "leading" | "trailing";
  /** Overrides global tree depth when a projection establishes a local indentation origin. */
  indentDepth?: number;
  /** Pairs this entry with the immediately preceding leading-column entry. */
  pairWithPrevious?: boolean;
}>;

export type OutlineVisualRow<Value> = Readonly<{
  entries: readonly Readonly<{
    index: number;
    layout: OutlineRowLayout;
    row: OutlineRow<Value>;
  }>[];
  key: string;
}>;

export type OutlineRenderedVisualRow<Value> =
  | Readonly<{ key: string; kind: "nodes"; visualRow: OutlineVisualRow<Value> }>
  | Readonly<{
      key: string;
      kind: "empty-child";
      layout: OutlineRowLayout;
      parent: OutlineRow<Value>;
    }>;

export function groupOutlineRows<Value>(
  rows: readonly OutlineRow<Value>[],
  getRowLayout?: (row: OutlineRow<Value>) => OutlineRowLayout,
): readonly OutlineVisualRow<Value>[] {
  const visualRows: { entries: { index: number; layout: OutlineRowLayout; row: OutlineRow<Value> }[]; key: string }[] =
    [];
  rows.forEach((row, index) => {
    const layout = getRowLayout?.(row) ?? {};
    const previous = visualRows.at(-1);
    const previousEntry = previous?.entries.at(-1);
    if (
      previous !== undefined &&
      layout.pairWithPrevious === true &&
      layout.column === "trailing" &&
      previousEntry?.layout.column === "leading"
    ) {
      previous.entries.push({ index, layout, row });
      previous.key = `${previous.key}|${row.key}`;
      return;
    }
    visualRows.push({ entries: [{ index, layout, row }], key: row.key });
  });
  return visualRows;
}

export function projectEmptyChildRows<Value>(
  rows: readonly OutlineVisualRow<Value>[],
  enabled: boolean,
): readonly OutlineRenderedVisualRow<Value>[] {
  return rows.flatMap((visualRow) => {
    const rendered: OutlineRenderedVisualRow<Value>[] = [{ key: visualRow.key, kind: "nodes", visualRow }];
    if (!enabled) {
      return rendered;
    }
    for (const { layout, row } of visualRow.entries) {
      if (row.expanded && row.expandable && !row.hasChildren) {
        rendered.push({
          key: `${row.key}/::empty-child`,
          kind: "empty-child",
          layout: { column: layout.column, indentDepth: (layout.indentDepth ?? row.depth) + 1 },
          parent: row,
        });
      }
    }
    return rendered;
  });
}
