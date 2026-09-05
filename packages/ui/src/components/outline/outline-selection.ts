import type { OutlineRowViewModel } from "./outline-tree-view-model.js";

export type OutlineSelection = Readonly<{
  anchorKey: string | null;
  focusKey: string | null;
  /** Explicitly selected appearances; descendants are covered by their selected ancestor. */
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
    keys: new Set(selectedOutlineRoots(rows, new Set(rows.slice(from, to + 1).map((row) => row.key)))),
  };
}

export function toggleOutlineRow(
  rows: readonly OutlineRowViewModel[],
  selection: OutlineSelection,
  key: string,
): OutlineSelection {
  const coveredBy = outlineSelectionCoverage(rows, selection.keys).get(key);
  if (coveredBy !== undefined && coveredBy !== key) {
    return selection;
  }
  const keys = new Set(selection.keys);
  if (keys.has(key)) {
    keys.delete(key);
  } else {
    keys.add(key);
  }
  const roots = new Set(selectedOutlineRoots(rows, keys));
  if (keys.size === 0) {
    return emptyOutlineSelection;
  }
  const focusKey = roots.has(key)
    ? key
    : roots.has(selection.anchorKey ?? "")
      ? selection.anchorKey
      : ([...roots][0] ?? null);
  return {
    anchorKey: roots.has(selection.anchorKey ?? "") ? selection.anchorKey : focusKey,
    focusKey,
    keys: roots,
  };
}

/** Derives visible coverage without losing a parent's selection when its children collapse. */
export function outlineSelectionCoverage(
  rows: readonly OutlineRowViewModel[],
  selectedKeys: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const coverage = new Map<string, string>();
  for (const row of rows) {
    const ancestor = row.parentKey === null ? undefined : coverage.get(row.parentKey);
    const root = ancestor ?? (selectedKeys.has(row.key) ? row.key : undefined);
    if (root !== undefined) {
      coverage.set(row.key, root);
    }
  }
  return coverage;
}

export function normalizeOutlineSelection(
  rows: readonly OutlineRowViewModel[],
  selection: OutlineSelection,
): OutlineSelection {
  const visible = new Set(rows.map((row) => row.key));
  const keys = new Set(selectedOutlineRoots(rows, new Set([...selection.keys].filter((key) => visible.has(key)))));
  const focusKey =
    selection.focusKey !== null && visible.has(selection.focusKey)
      ? selection.focusKey
      : (rows.find((row) => keys.has(row.key))?.key ?? null);
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
