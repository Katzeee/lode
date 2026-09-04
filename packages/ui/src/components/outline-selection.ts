import type { OutlineRowViewModel } from "./outline-tree-view-model.js";

export type OutlineSelection = Readonly<{
  anchorKey: string | null;
  focusKey: string | null;
  keys: ReadonlySet<string>;
}>;

export const emptyOutlineSelection: OutlineSelection = {
  anchorKey: null,
  focusKey: null,
  keys: new Set(),
};

export function selectOutlineRow(key: string): OutlineSelection {
  return { anchorKey: key, focusKey: key, keys: new Set([key]) };
}

export function extendOutlineSelection(
  rows: readonly OutlineRowViewModel[],
  selection: OutlineSelection,
  focusKey: string,
): OutlineSelection {
  const anchorKey = selection.anchorKey ?? selection.focusKey ?? focusKey;
  const anchorIndex = rows.findIndex((row) => row.key === anchorKey);
  const focusIndex = rows.findIndex((row) => row.key === focusKey);
  if (anchorIndex < 0 || focusIndex < 0) {
    return selectOutlineRow(focusKey);
  }
  const from = Math.min(anchorIndex, focusIndex);
  const to = Math.max(anchorIndex, focusIndex);
  return {
    anchorKey,
    focusKey,
    keys: new Set(rows.slice(from, to + 1).map((row) => row.key)),
  };
}

export function toggleOutlineRow(selection: OutlineSelection, key: string): OutlineSelection {
  const keys = new Set(selection.keys);
  if (keys.has(key)) {
    keys.delete(key);
  } else {
    keys.add(key);
  }
  if (keys.size === 0) {
    return emptyOutlineSelection;
  }
  const focusKey = keys.has(key)
    ? key
    : keys.has(selection.anchorKey ?? "")
      ? selection.anchorKey
      : ([...keys][0] ?? null);
  return {
    anchorKey: keys.has(selection.anchorKey ?? "") ? selection.anchorKey : key,
    focusKey,
    keys,
  };
}

export function normalizeOutlineSelection(
  rows: readonly OutlineRowViewModel[],
  selection: OutlineSelection,
): OutlineSelection {
  const visible = new Set(rows.map((row) => row.key));
  const keys = new Set([...selection.keys].filter((key) => visible.has(key)));
  const focusKey = selection.focusKey !== null && visible.has(selection.focusKey) ? selection.focusKey : null;
  const anchorKey = selection.anchorKey !== null && visible.has(selection.anchorKey) ? selection.anchorKey : focusKey;
  if (keys.size === 0 || focusKey === null) {
    return emptyOutlineSelection;
  }
  return { anchorKey, focusKey, keys };
}

export function selectedOutlineRoots(
  rows: readonly OutlineRowViewModel[],
  selectedKeys: ReadonlySet<string>,
): readonly string[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return rows
    .filter((row) => {
      if (!selectedKeys.has(row.key)) {
        return false;
      }
      let parentKey = row.parentKey;
      while (parentKey !== null) {
        if (selectedKeys.has(parentKey)) {
          return false;
        }
        parentKey = byKey.get(parentKey)?.parentKey ?? null;
      }
      return true;
    })
    .map((row) => row.key);
}
