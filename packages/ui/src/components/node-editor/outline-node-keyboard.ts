import { contentLength, type OutlineContent } from "./outline-content.js";
import { discloseOutline } from "./outline-edit-intents.js";
import {
  emptyOutlineSelection,
  extendOutlineSelection,
  selectOutlineRow,
  selectedOutlineRoots,
  type OutlineSelection,
} from "./outline-selection.js";
import type { useOutlineEdit } from "./outline-tree-edit.js";
import type { OutlineTextKeyContext, OutlineTreeEditing } from "./outline-tree-edit-contract.js";
import type { OutlineEditPosition, OutlineRowViewModel } from "./outline-tree-view-model.js";

export type OutlineSelectionOperation = "indent" | "outdent" | "reorder-up" | "reorder-down";

export function outlineNodeTextContext(
  cursor: OutlineRowViewModel,
  position: OutlineEditPosition | null,
): OutlineTextKeyContext {
  const caret = position?.key === cursor.key ? position : null;
  return {
    content: cursor.item.content,
    atTop: true,
    atBottom: true,
    from: caret?.caret ?? contentLength(cursor.item.content),
    to: caret?.selectionEnd ?? caret?.caret ?? contentLength(cursor.item.content),
  };
}

export function handleEmptyOutlineKey(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  navigate: (direction: -1 | 1) => boolean,
  create?: (content: OutlineContent) => void,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  if (!event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    return navigate(event.key === "ArrowUp" ? -1 : 1);
  }
  if (create !== undefined && (event.key.length === 1 || event.key === "Enter")) {
    create(event.key === "Enter" ? [] : [{ type: "text", text: event.key }]);
    return true;
  }
  return false;
}
export type OutlineNodeKeyboardContext = Readonly<{
  rows: readonly OutlineRowViewModel[];
  cursorKey: string | null;
  selection: OutlineSelection;
  select: (selection: OutlineSelection) => void;
  activate: (position: OutlineEditPosition) => void;
  move: (keys: readonly string[], operation: OutlineSelectionOperation) => void;
  remove: (keys: readonly string[]) => void;
  duplicate: (keys: readonly string[]) => void;
  expand: (key: string, expanded: boolean) => void;
}>;

/** Explicit item selection never replaces the independent text caret. */
export function handleOutlineNodeKey(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  text: OutlineTextKeyContext,
  context: OutlineNodeKeyboardContext,
): boolean {
  const { rows, selection, cursorKey } = context;
  const modified = event.ctrlKey || event.metaKey;
  const selected = selection.keys.size > 0;
  const cursor = rows.find((row) => row.key === cursorKey);
  if (cursor === undefined) {
    return false;
  }
  if (event.key === "Escape") {
    context.select(selected ? emptyOutlineSelection : selectOutlineRow(cursor.key));
    return true;
  }
  if (
    modified &&
    !event.altKey &&
    event.key.toLowerCase() === "a" &&
    (selected || (text.from === 0 && text.to === contentLength(text.content)))
  ) {
    const roots = rows.filter((row) => row.parentKey === null);
    context.select({
      anchorKey: roots[0]?.key ?? cursor.key,
      focusKey: roots.at(-1)?.key ?? cursor.key,
      keys: new Set(roots.map((row) => row.key)),
    });
    return true;
  }
  const verticalSelection =
    !modified &&
    !event.altKey &&
    event.shiftKey &&
    ((event.key === "ArrowDown" && text.atBottom) || (event.key === "ArrowUp" && text.atTop));
  if (verticalSelection) {
    if (!selected) {
      context.select(selectOutlineRow(cursor.key));
    } else {
      const index = rows.findIndex((row) => row.key === (selection.focusKey ?? cursor.key));
      const target = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (target !== undefined) {
        const next = extendOutlineSelection(rows, selection, target.key);
        context.activate({ key: target.key, caret: 0 });
        context.select(next);
      }
    }
    return true;
  }
  if (!selected) {
    return false;
  }
  const roots = selectedOutlineRoots(rows, selection.keys);
  if (event.altKey && event.shiftKey && !modified && event.key.toLowerCase() === "d") {
    context.duplicate(roots);
    return true;
  }
  if (event.key === "Tab" && !modified && !event.altKey) {
    context.move(roots, event.shiftKey ? "outdent" : "indent");
    return true;
  }
  if (event.altKey && event.shiftKey && !modified && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    context.move(roots, event.key === "ArrowUp" ? "reorder-up" : "reorder-down");
    return true;
  }
  if (!event.altKey && (event.key === "Backspace" || event.key === "Delete")) {
    context.remove(roots);
    return true;
  }
  if (modified && !event.altKey && ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) {
    for (const key of roots) {
      const row = rows.find((candidate) => candidate.key === key);
      if (row !== undefined) {
        discloseOutline(row, event.key === "ArrowDown" || event.key === "PageDown", event.shiftKey, context.expand);
      }
    }
    return true;
  }
  if (
    !modified &&
    !event.altKey &&
    (event.key.length === 1 || event.key === "Enter" || event.key.startsWith("Arrow"))
  ) {
    context.select(emptyOutlineSelection);
  }
  return false;
}

export function handleRestingOutlineKey(
  event: KeyboardEvent,
  context: Readonly<{
    rows: readonly OutlineRowViewModel[];
    cursorKey: string | null;
    edit: ReturnType<typeof useOutlineEdit>;
    editing?: OutlineTreeEditing;
    createRoot?: (content: OutlineContent) => void;
    handleNodeKey(event: KeyboardEvent, text: OutlineTextKeyContext): boolean;
    expand(key: string, expanded: boolean): void;
    move(keys: readonly string[], operation: OutlineSelectionOperation): void;
    activate(row: OutlineRowViewModel, caret: number): void;
    select(selection: OutlineSelection): void;
    onActivate(row: OutlineRowViewModel): void;
  }>,
): void {
  const { rows, cursorKey, edit, editing, createRoot, handleNodeKey, expand, move, activate, select } = context;
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    ["z", "y"].includes(event.key.toLowerCase()) &&
    edit.history(event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo")
  ) {
    event.preventDefault();
    return;
  }
  const cursor = rows.find((row) => row.key === cursorKey) ?? rows[0];
  if (cursor === undefined) {
    if (handleEmptyOutlineKey(event, edit.navigateOutside, createRoot)) {
      event.preventDefault();
    }
    return;
  }
  const text = outlineNodeTextContext(cursor, edit.getPosition());
  if (handleNodeKey(event, text)) {
    event.preventDefault();
    return;
  }
  const modified = event.ctrlKey || event.metaKey;
  let handled = true;
  if (modified && !event.altKey && ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) {
    discloseOutline(cursor, event.key === "ArrowDown" || event.key === "PageDown", event.shiftKey, expand);
  } else if (event.altKey && event.shiftKey && !modified && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    move([cursor.key], event.key === "ArrowUp" ? "reorder-up" : "reorder-down");
  } else if (event.key === "Tab" && !modified && !event.altKey) {
    move([cursor.key], event.shiftKey ? "outdent" : "indent");
  } else if (event.key === "Enter" && !event.altKey && !modified) {
    if (editing === undefined || cursor.item.editable === false) {
      context.onActivate(cursor);
    } else if (cursor.item.activation === "object" && !event.shiftKey) {
      select(emptyOutlineSelection);
      edit.startAtEnd(cursor);
    } else {
      edit.enterFromSelection(cursor, event.shiftKey ? "after" : undefined);
    }
  } else if (
    cursor.item.activation === "object" &&
    (event.key === "Backspace" || event.key === "Delete") &&
    !modified &&
    !event.altKey
  ) {
    const position = cursor.item.capabilities?.remove === false ? undefined : editing?.onClearAppearance?.(cursor.key);
    if (position) {
      edit.restore(position);
    }
  } else if (cursor.item.activation === "object" && event.key === " ") {
    context.onActivate(cursor);
  } else if (!modified && !event.altKey && event.key.startsWith("Arrow")) {
    const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
    const target = rows[rows.indexOf(cursor) + direction];
    if (target !== undefined) {
      activate(target, event.key === "ArrowLeft" ? contentLength(target.item.content) : 0);
    } else {
      edit.navigateOutside(direction);
    }
  } else if (event.key === "Home" || event.key === "End") {
    const target = event.key === "Home" ? rows[0] : rows.at(-1);
    if (target !== undefined) {
      activate(target, event.key === "Home" ? 0 : contentLength(target.item.content));
    }
  } else if (!modified && !event.altKey && event.key.length === 1) {
    if (cursor.item.activation !== "object") {
      edit.startAtEnd(cursor, event.key);
    }
  } else {
    handled = false;
  }
  if (handled) {
    event.preventDefault();
  }
}
