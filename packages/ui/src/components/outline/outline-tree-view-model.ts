import { contentLength, mergeContent, type OutlineContent } from "./outline-content.js";

/** The complete component contract consumed by OutlineTree. Its presentation is opaque host data. */
export type OutlineItemViewModel<Presentation = unknown> = Readonly<{
  accessibilityLabel: string;
  children?: readonly OutlineItemViewModel<Presentation>[];
  content: OutlineContent;
  editable?: boolean;
  /** Object appearances activate their content editor explicitly, using the same editing session. */
  activation?: "text" | "object";
  mergeable?: boolean;
  /** The host explains why this name cannot be edited here. */
  readonlyReason?: string;
  /** Controls whether this item exposes a disclosure affordance; false keeps existing children visible. */
  expandable?: boolean;
  /** Stable, opaque identity for this presented appearance. OutlineTree never parses or constructs it. */
  key: string;
  presentation: Presentation;
}>;

export type OutlineRowViewModel<Presentation = unknown> = Readonly<{
  depth: number;
  expanded: boolean;
  expandable: boolean;
  hasChildren: boolean;
  indexInParent: number;
  item: OutlineItemViewModel<Presentation>;
  key: string;
  parentKey: string | null;
  siblingCount: number;
}>;

export type OutlineMove = Readonly<{
  index: number;
  sourceKeys: readonly string[];
  targetParentKey: string | null;
}>;

/** The host maps appearances whose opaque keys change after a move. */
export type OutlineMoveResult = Readonly<{ keyMap: ReadonlyMap<string, string> }>;
export type OutlineInsertionPlacement = "before" | "after" | "child";

export type OutlineMerge = Readonly<{
  content: OutlineContent;
  sourceKey: string;
  targetKey: string;
}>;

export type OutlineEditPosition = Readonly<{
  editing?: boolean;
  caret: number;
  key: string;
  selectionEnd?: number;
}>;

export type OutlineEditMergeTarget = OutlineEditPosition & Readonly<{ content: OutlineContent }>;

export type OutlineEditInsertion = Readonly<{
  displacedKey: string | null;
  indexInParent: number;
  parentKey: string | null;
}>;

export function flattenOutline<Presentation>(
  items: readonly OutlineItemViewModel<Presentation>[],
  expandedKeys: ReadonlySet<string>,
): OutlineRowViewModel<Presentation>[] {
  const rows: OutlineRowViewModel<Presentation>[] = [];
  const visit = (siblings: readonly OutlineItemViewModel<Presentation>[], parentKey: string | null, depth: number) => {
    siblings.forEach((item, indexInParent) => {
      const hasChildren = item.children !== undefined && item.children.length > 0;
      const expandable = item.expandable !== false;
      const expanded = hasChildren && !expandable ? true : expandable && expandedKeys.has(item.key);
      rows.push({
        depth,
        expanded,
        expandable,
        hasChildren,
        indexInParent,
        item,
        key: item.key,
        parentKey,
        siblingCount: siblings.length,
      });
      if (expanded && item.children !== undefined) {
        visit(item.children, item.key, depth + 1);
      }
    });
  };
  visit(items, null, 0);
  return rows;
}

function rowByKey(rows: readonly OutlineRowViewModel[], key: string): OutlineRowViewModel | undefined {
  return rows.find((row) => row.key === key);
}

function previousSibling(
  rows: readonly OutlineRowViewModel[],
  row: OutlineRowViewModel,
): OutlineRowViewModel | undefined {
  return rows.find(
    (candidate) => candidate.parentKey === row.parentKey && candidate.indexInParent === row.indexInParent - 1,
  );
}

function siblingSelection(
  rows: readonly OutlineRowViewModel[],
  sourceKeys: readonly string[],
): readonly OutlineRowViewModel[] | null {
  const selected = sourceKeys
    .map((key) => rowByKey(rows, key))
    .filter((row): row is OutlineRowViewModel => row !== undefined)
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
export function computeIndent(rows: readonly OutlineRowViewModel[], sourceKeys: readonly string[]): OutlineMove | null {
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
    index: target.item.children?.length ?? 0,
    sourceKeys: selected.map((candidate) => candidate.key),
    targetParentKey: target.key,
  };
}

/** Shift+Tab: the selected sibling run moves out to sit right after its parent. */
export function computeOutdent(
  rows: readonly OutlineRowViewModel[],
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

/** Reorder a selected sibling run, jumping whole subtrees. */
export function computeReorder(
  rows: readonly OutlineRowViewModel[],
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

export function computeEditNavigation(
  rows: readonly OutlineRowViewModel[],
  key: string,
  direction: -1 | 1,
  caret: number | "end",
): OutlineEditPosition | null {
  const index = rows.findIndex((row) => row.key === key);
  const target = rows[index + direction];
  if (index < 0 || target === undefined) {
    return null;
  }
  const targetLength = contentLength(target.item.content);
  return {
    caret: caret === "end" ? targetLength : Math.max(0, Math.min(caret, targetLength)),
    key: target.key,
  };
}

export function computeEditMergeTarget(
  rows: readonly OutlineRowViewModel[],
  key: string,
  currentContent: OutlineContent,
): OutlineEditMergeTarget | null {
  const source = rowByKey(rows, key);
  if (!source || source.hasChildren || source.item.mergeable === false || source.item.activation === "object") {
    return null;
  }
  const target =
    source.indexInParent > 0
      ? rows.find((row) => row.parentKey === source.parentKey && row.indexInParent === source.indexInParent - 1)
      : rows.find((row) => row.key === source.parentKey);
  if (
    !target ||
    target.item.editable === false ||
    target.item.mergeable === false ||
    target.item.activation === "object"
  ) {
    return null;
  }
  return {
    key: target.key,
    caret: contentLength(target.item.content),
    content: mergeContent(target.item.content, currentContent),
  };
}

export function computeEditInsertion(
  rows: readonly OutlineRowViewModel[],
  key: string,
  placement: OutlineInsertionPlacement = "after",
): OutlineEditInsertion | null {
  const row = rowByKey(rows, key);
  if (row === undefined) {
    return null;
  }
  const parentKey = placement === "child" ? row.key : row.parentKey;
  const indexInParent = placement === "child" ? 0 : row.indexInParent + (placement === "after" ? 1 : 0);
  const displaced = rows.find(
    (candidate) => candidate.parentKey === parentKey && candidate.indexInParent === indexInParent,
  );
  return { displacedKey: displaced?.key ?? null, indexInParent, parentKey };
}

export function resolveEditInsertion(
  rows: readonly OutlineRowViewModel[],
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
