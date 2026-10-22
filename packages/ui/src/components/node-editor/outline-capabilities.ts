import type {
  OutlineInsertionPlacement,
  OutlineItemViewModel,
  OutlineMoveDestination,
  OutlineRowViewModel,
} from "./outline-tree-view-model.js";

export type OutlineItemCapabilities = Readonly<{
  insertSiblings?: boolean;
  insertChildren?: boolean;
  move?: boolean;
  remove?: boolean;
}>;

export function canInsertOutline(item: OutlineItemViewModel, placement: OutlineInsertionPlacement): boolean {
  return item.capabilities?.[placement === "child" ? "insertChildren" : "insertSiblings"] !== false;
}

export function canRemoveOutline(rows: readonly OutlineRowViewModel[], keys: readonly string[]): boolean {
  return (
    keys.length > 0 &&
    keys.every((key) => {
      const row = rows.find((row) => row.key === key);
      return row !== undefined && row.item.capabilities?.remove !== false;
    })
  );
}

export function canMoveOutline(rows: readonly OutlineRowViewModel[], move: OutlineMoveDestination): boolean {
  const sources = move.sourceKeys.map((key) => rows.find((row) => row.key === key));
  if (sources.length === 0 || sources.some((row) => row === undefined || row.item.capabilities?.move === false)) {
    return false;
  }
  if (sources.every((row) => row?.parentKey === move.targetParentKey)) {
    return true;
  }
  if (move.targetParentKey !== null) {
    const target = rows.find((row) => row.key === move.targetParentKey);
    return target !== undefined && canInsertOutline(target.item, "child");
  }
  const siblings = rows.filter((row) => row.parentKey === null);
  const adjacent = siblings[move.index] ?? siblings.at(-1);
  return adjacent === undefined || canInsertOutline(adjacent.item, "after");
}
