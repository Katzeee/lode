import {
  appendText,
  contentLength,
  mergeContent,
  sliceContent,
  splitContent,
  type OutlineContent,
} from "./outline-content.js";
import type { OutlineEditorCommand, OutlineTreeEditing } from "./outline-tree-edit-contract.js";
import {
  computeEditInsertion,
  computeEditMergeTarget,
  computeEditNavigation,
  type OutlineEditInsertion,
  type OutlineEditPosition,
  type OutlineInsertionPlacement,
  type OutlineRowViewModel,
  type OutlineItemViewModel,
} from "./outline-tree-view-model.js";

export type OutlineEditIntentContext = Readonly<{
  editing?: OutlineTreeEditing;
  rows: readonly OutlineRowViewModel[];
  commit: (key: string, content: OutlineContent) => void;
  insert: (insertion: OutlineEditInsertion) => void;
  activate: (position: OutlineEditPosition, content?: OutlineContent) => void;
  remove?: (keys: readonly string[]) => void;
  exit: () => void;
  expand: (key: string, expanded: boolean) => void;
}>;

export function positionAfterDisclosure(
  rows: readonly OutlineRowViewModel[],
  key: string,
  expanded: boolean,
  position: OutlineEditPosition | null,
): OutlineEditPosition | null {
  let ancestor = rows.find((row) => row.key === position?.key)?.parentKey;
  while (!expanded && ancestor !== undefined && ancestor !== null) {
    if (ancestor === key) {
      return { key, caret: 0 };
    }
    ancestor = rows.find((row) => row.key === ancestor)?.parentKey;
  }
  return position;
}

export function discloseOutline(
  row: OutlineRowViewModel,
  expanded: boolean,
  recursive: boolean,
  onExpandedChange: (key: string, expanded: boolean) => void,
) {
  const visit = (item: OutlineItemViewModel) => {
    if (item.expandable !== false && (item.key === row.key || (item.children?.length ?? 0) > 0)) {
      onExpandedChange(item.key, expanded);
    }
    if (recursive) {
      item.children?.forEach(visit);
    }
  };
  visit(row.item);
}

function deleteFromEditor(context: OutlineEditIntentContext, key: string, content: OutlineContent): boolean {
  const index = context.rows.findIndex((row) => row.key === key);
  const source = context.rows[index];
  if (source === undefined || context.remove === undefined) {
    return false;
  }
  const target = context.rows[index - 1] ?? context.rows.slice(index + 1).find((row) => row.depth <= source.depth);
  context.commit(key, content);
  context.remove([key]);
  if (target === undefined) {
    context.exit();
  } else {
    context.activate({ key: target.key, caret: contentLength(target.item.content) });
  }
  return true;
}

export function dispatchEditIntent(
  context: OutlineEditIntentContext,
  key: string,
  command: OutlineEditorCommand,
): boolean {
  switch (command.type) {
    case "enter":
      return insertFromEditor(context, key, command.content, command.from, command.to, command.placement);
    case "backspace":
      return backspaceFromEditor(context, key, command.content);
    case "delete-forward": {
      const next = computeEditNavigation(context.rows, key, 1, 0);
      const source = context.rows.find((row) => row.key === next?.key);
      if (
        source === undefined ||
        source.hasChildren ||
        source.item.editable === false ||
        context.editing?.onMerge === undefined
      ) {
        return true;
      }
      const merged = mergeContent(command.content, source.item.content);
      context.commit(key, command.content);
      context.editing.onMerge({ sourceKey: source.key, targetKey: key, content: merged });
      context.activate({ key, caret: contentLength(command.content) }, merged);
      return true;
    }
    case "delete":
      return deleteFromEditor(context, key, command.content);
    case "toggle": {
      context.commit(key, command.content);
      context.editing?.onToggle?.(key);
      return true;
    }
    case "disclosure": {
      context.commit(key, command.content);
      const row = context.rows.find((candidate) => candidate.key === key);
      if (row !== undefined) {
        discloseOutline(row, command.expanded, command.recursive === true, context.expand);
      }
      return true;
    }
    case "navigate": {
      const position = computeEditNavigation(context.rows, key, command.direction, command.caret);
      if (context.editing === undefined || position === null) {
        return false;
      }
      context.commit(key, command.content);
      context.activate(position);
      return true;
    }
    case "structure":
    case "history":
    case "duplicate":
      return false;
  }
}

export function resumeTyping(content: OutlineContent, position: OutlineEditPosition | null, text: string) {
  const caret = Math.min(position?.caret ?? contentLength(content), contentLength(content));
  const updated =
    text.length > 0 && position !== null
      ? mergeContent(
          sliceContent(content, 0, caret),
          [{ text, type: "text" }],
          sliceContent(content, Math.max(caret, position.selectionEnd ?? caret), contentLength(content)),
        )
      : appendText(content, text);
  return { content: updated, caret: text.length > 0 ? caret + text.length : contentLength(updated) };
}

export function insertFromEditor(
  context: OutlineEditIntentContext,
  key: string,
  content: OutlineContent,
  from: number,
  to: number,
  forced?: OutlineInsertionPlacement,
): boolean {
  const { editing, rows } = context;
  const row = rows.find((candidate) => candidate.key === key);
  const atStart = from === 0 && to === 0 && contentLength(content) > 0;
  const placement =
    forced ??
    (atStart
      ? "before"
      : row?.expanded === true && row.hasChildren && editing?.onCreateChild !== undefined
        ? "child"
        : "after");
  const insertion = computeEditInsertion(rows, key, placement);
  if (editing === undefined || insertion === null) {
    return false;
  }
  context.commit(key, content);
  context.insert(insertion);
  if (forced !== undefined || atStart || (from === to && to === contentLength(content))) {
    if (placement === "before") {
      editing.onCreateBefore(key);
    } else if (placement === "child") {
      editing.onCreateChild?.(key);
    } else {
      editing.onCreateAfter(key);
    }
  } else {
    const split = splitContent(content, from, to);
    editing.onSplit(key, split.before, split.after, placement === "child" ? "child" : "after");
  }
  return true;
}

function backspaceFromEditor(context: OutlineEditIntentContext, key: string, content: OutlineContent): boolean {
  const { editing, rows } = context;
  if (editing === undefined) {
    return false;
  }
  // Deleting a parent as a text merge would also remove its owned child graph.
  if (rows.find((row) => row.key === key)?.hasChildren === true) {
    return true;
  }
  const previous = computeEditNavigation(rows, key, -1, "end");
  if (previous === null) {
    return false;
  }
  if (contentLength(content) === 0) {
    context.commit(key, content);
    editing.onDeleteEmpty(key);
    context.activate(previous);
    return true;
  }
  if (editing.onMerge === undefined) {
    return false;
  }
  const merge = computeEditMergeTarget(rows, key, content);
  const target = merge === null ? undefined : rows.find((row) => row.key === merge.key);
  if (merge === null || target === undefined || target.item.editable === false) {
    return false;
  }
  context.commit(key, content);
  editing.onMerge({ content: merge.content, sourceKey: key, targetKey: merge.key });
  context.activate(merge, merge.content);
  return true;
}
