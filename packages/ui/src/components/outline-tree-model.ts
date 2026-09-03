import { contentLength, mergeContent, type OutlineContent } from "./outline-content.js";

export type OutlineNode<Value> = Readonly<{
  children?: readonly OutlineNode<Value>[];
  id: string;
  /**
   * Every entry in a children array is one appearance of a node. A
   * "reference" appearance embeds a node whose original lives elsewhere;
   * the tree marks it on the bullet so borrowed structure stays legible.
   */
  kind?: "node" | "reference";
  value: Value;
}>;

// A row is one *appearance* of a node: the same node can appear under many
// parents (references), so rows key on the full path, never the node id.
export type OutlineRow<Value> = Readonly<{
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  indexInParent: number;
  key: string;
  node: OutlineNode<Value>;
  parentKey: string | null;
  siblingCount: number;
}>;

export type OutlineMove = Readonly<{
  index: number;
  sourceKey: string;
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

export function rowKey(parentKey: string | null, id: string): string {
  return parentKey === null ? id : `${parentKey}/${id}`;
}

export function flattenOutline<Value>(
  nodes: readonly OutlineNode<Value>[],
  expandedKeys: ReadonlySet<string>,
): OutlineRow<Value>[] {
  const rows: OutlineRow<Value>[] = [];
  const visit = (siblings: readonly OutlineNode<Value>[], parentKey: string | null, depth: number) => {
    siblings.forEach((node, indexInParent) => {
      const key = rowKey(parentKey, node.id);
      const hasChildren = node.children !== undefined && node.children.length > 0;
      const expanded = hasChildren && expandedKeys.has(key);
      rows.push({
        depth,
        expanded,
        hasChildren,
        indexInParent,
        key,
        node,
        parentKey,
        siblingCount: siblings.length,
      });
      if (expanded && node.children !== undefined) {
        visit(node.children, key, depth + 1);
      }
    });
  };
  visit(nodes, null, 0);
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

/** Tab: the row becomes the last child of its previous sibling. */
export function computeIndent<Value>(rows: readonly OutlineRow<Value>[], key: string): OutlineMove | null {
  const row = rowByKey(rows, key);
  if (row === undefined || row.indexInParent === 0) {
    return null;
  }
  const target = previousSibling(rows, row);
  if (target === undefined) {
    return null;
  }
  return {
    index: target.node.children?.length ?? 0,
    sourceKey: row.key,
    targetParentKey: target.key,
  };
}

/** Shift+Tab: the row moves out to sit right after its parent. */
export function computeOutdent<Value>(rows: readonly OutlineRow<Value>[], key: string): OutlineMove | null {
  const row = rowByKey(rows, key);
  if (row === undefined || row.parentKey === null) {
    return null;
  }
  const parent = rowByKey(rows, row.parentKey);
  if (parent === undefined) {
    return null;
  }
  return {
    index: parent.indexInParent + 1,
    sourceKey: row.key,
    targetParentKey: parent.parentKey,
  };
}

/** Ctrl+ArrowUp / Ctrl+ArrowDown: reorder among siblings, jumping subtrees. */
export function computeReorder<Value>(
  rows: readonly OutlineRow<Value>[],
  key: string,
  direction: -1 | 1,
): OutlineMove | null {
  const row = rowByKey(rows, key);
  if (row === undefined) {
    return null;
  }
  const index = row.indexInParent + direction;
  if (index < 0 || index >= row.siblingCount) {
    return null;
  }
  return { index, sourceKey: row.key, targetParentKey: row.parentKey };
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
