import { contentLength, mergeContent, type OutlineContent } from "./outline-content.js";

export type OutlineOccurrence<Value> = Readonly<{
  /** Appearance belongs to this Occurrence; Reference children can still expose the target Node's own Occurrences. */
  appearance?: "original" | "reference";
  children?: readonly OutlineOccurrence<Value>[];
  /** Controls whether this occurrence exposes a disclosure affordance; false keeps existing children visible. */
  expandable?: boolean;
  nodeId: string;
  /** Stable placement identity, independent from the Node shared by Original and Reference appearances. */
  occurrenceId: string;
  value: Value;
}>;

// A row projects one Occurrence. References can share a Node while keeping
// independent placement identity, so rows key on the occurrence path.
export type OutlineRow<Value> = Readonly<{
  depth: number;
  expanded: boolean;
  expandable: boolean;
  hasChildren: boolean;
  indexInParent: number;
  key: string;
  occurrence: OutlineOccurrence<Value>;
  parentKey: string | null;
  siblingCount: number;
}>;

export type OutlineMove = Readonly<{
  index: number;
  sourceKeys: readonly string[];
  targetParentKey: string | null;
}>;

export type OutlineEditPosition = Readonly<{
  caret: number;
  key: string;
}>;

export type OutlineEditMergeTarget = OutlineEditPosition & Readonly<{ content: OutlineContent }>;

export type OutlineEditInsertion = Readonly<{
  displacedKey: string | null;
  indexInParent: number;
  parentKey: string | null;
}>;

export function rowKey(parentKey: string | null, occurrenceId: string): string {
  return parentKey === null ? occurrenceId : `${parentKey}/${occurrenceId}`;
}

export function flattenOutline<Value>(
  occurrences: readonly OutlineOccurrence<Value>[],
  expandedKeys: ReadonlySet<string>,
): OutlineRow<Value>[] {
  const rows: OutlineRow<Value>[] = [];
  const visit = (siblings: readonly OutlineOccurrence<Value>[], parentKey: string | null, depth: number) => {
    siblings.forEach((occurrence, indexInParent) => {
      const key = rowKey(parentKey, occurrence.occurrenceId);
      const hasChildren = occurrence.children !== undefined && occurrence.children.length > 0;
      const expandable = occurrence.expandable !== false;
      const expanded = hasChildren && !expandable ? true : expandable && expandedKeys.has(key);
      rows.push({
        depth,
        expanded,
        expandable,
        hasChildren,
        indexInParent,
        key,
        occurrence,
        parentKey,
        siblingCount: siblings.length,
      });
      if (expanded && occurrence.children !== undefined) {
        visit(occurrence.children, key, depth + 1);
      }
    });
  };
  visit(occurrences, null, 0);
  return rows;
}

function rowByKey<Value>(rows: readonly OutlineRow<Value>[], key: string): OutlineRow<Value> | undefined {
  return rows.find((row) => row.key === key);
}

function previousSibling<Value>(
  rows: readonly OutlineRow<Value>[],
  row: OutlineRow<Value>,
): OutlineRow<Value> | undefined {
  return rows.find(
    (candidate) => candidate.parentKey === row.parentKey && candidate.indexInParent === row.indexInParent - 1,
  );
}

function siblingSelection<Value>(
  rows: readonly OutlineRow<Value>[],
  sourceKeys: readonly string[],
): readonly OutlineRow<Value>[] | null {
  const selected = sourceKeys
    .map((key) => rowByKey(rows, key))
    .filter((row): row is OutlineRow<Value> => row !== undefined)
    .sort((left, right) => left.indexInParent - right.indexInParent);
  const parentKey = selected[0]?.parentKey;
  if (
    selected.length !== sourceKeys.length ||
    selected.length === 0 ||
    selected.some((row) => row.parentKey !== parentKey) ||
    selected.some((row, index) => index > 0 && row.indexInParent !== selected[index - 1]!.indexInParent + 1)
  ) {
    return null;
  }
  return selected;
}

/** Tab: the selected sibling run becomes the last children of its previous sibling. */
export function computeIndent<Value>(
  rows: readonly OutlineRow<Value>[],
  sourceKeys: readonly string[],
): OutlineMove | null {
  const selected = siblingSelection(rows, sourceKeys);
  const row = selected?.[0];
  if (selected === null || row === undefined || row.indexInParent === 0) {
    return null;
  }
  const target = previousSibling(rows, row);
  if (target === undefined) {
    return null;
  }
  return {
    index: target.occurrence.children?.length ?? 0,
    sourceKeys: selected.map((candidate) => candidate.key),
    targetParentKey: target.key,
  };
}

/** Shift+Tab: the selected sibling run moves out to sit right after its parent. */
export function computeOutdent<Value>(
  rows: readonly OutlineRow<Value>[],
  sourceKeys: readonly string[],
): OutlineMove | null {
  const selected = siblingSelection(rows, sourceKeys);
  const row = selected?.[0];
  if (selected === null || row === undefined || row.parentKey === null) {
    return null;
  }
  const parent = rowByKey(rows, row.parentKey);
  if (parent === undefined) {
    return null;
  }
  return {
    index: parent.indexInParent + 1,
    sourceKeys: selected.map((candidate) => candidate.key),
    targetParentKey: parent.parentKey,
  };
}

/** Ctrl+Shift+Arrow: reorder a selected sibling run, jumping whole subtrees. */
export function computeReorder<Value>(
  rows: readonly OutlineRow<Value>[],
  sourceKeys: readonly string[],
  direction: -1 | 1,
): OutlineMove | null {
  const selected = siblingSelection(rows, sourceKeys);
  const first = selected?.[0];
  const last = selected?.at(-1);
  if (selected === null || first === undefined || last === undefined) {
    return null;
  }
  if (
    (direction === -1 && first.indexInParent === 0) ||
    (direction === 1 && last.indexInParent >= last.siblingCount - 1)
  ) {
    return null;
  }
  return {
    index: first.indexInParent + direction,
    sourceKeys: selected.map((candidate) => candidate.key),
    targetParentKey: first.parentKey,
  };
}

export function computeEditNavigation<Value>(
  rows: readonly OutlineRow<Value>[],
  key: string,
  direction: -1 | 1,
  caret: number | "end",
  contentOf: (row: OutlineRow<Value>) => OutlineContent,
): OutlineEditPosition | null {
  const index = rows.findIndex((row) => row.key === key);
  const target = rows[index + direction];
  if (index < 0 || target === undefined) {
    return null;
  }
  const targetLength = contentLength(contentOf(target));
  return {
    caret: caret === "end" ? targetLength : Math.max(0, Math.min(caret, targetLength)),
    key: target.key,
  };
}

export function computeEditMergeTarget<Value>(
  rows: readonly OutlineRow<Value>[],
  key: string,
  currentContent: OutlineContent,
  contentOf: (row: OutlineRow<Value>) => OutlineContent,
): OutlineEditMergeTarget | null {
  const position = computeEditNavigation(rows, key, -1, "end", contentOf);
  const target = position === null ? undefined : rowByKey(rows, position.key);
  if (position === null || target === undefined) {
    return null;
  }
  return { ...position, content: mergeContent(contentOf(target), currentContent) };
}

export function computeEditInsertion<Value>(
  rows: readonly OutlineRow<Value>[],
  key: string,
): OutlineEditInsertion | null {
  const row = rowByKey(rows, key);
  if (row === undefined) {
    return null;
  }
  const indexInParent = row.indexInParent + 1;
  const displaced = rows.find(
    (candidate) => candidate.parentKey === row.parentKey && candidate.indexInParent === indexInParent,
  );
  return { displacedKey: displaced?.key ?? null, indexInParent, parentKey: row.parentKey };
}

export function resolveEditInsertion<Value>(
  rows: readonly OutlineRow<Value>[],
  insertion: OutlineEditInsertion,
): OutlineEditPosition | null {
  const inserted = rows.find(
    (row) => row.parentKey === insertion.parentKey && row.indexInParent === insertion.indexInParent,
  );
  if (inserted === undefined || inserted.key === insertion.displacedKey) {
    return null;
  }
  return { caret: 0, key: inserted.key };
}
