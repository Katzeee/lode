import { contentLength } from "./outline-content.js";
import { discloseOutline } from "./outline-edit-intents.js";
import {
  emptyOutlineSelection,
  extendOutlineSelection,
  selectOutlineRow,
  selectedOutlineRoots,
  type OutlineSelection,
} from "./outline-selection.js";
import type { OutlineTextKeyContext } from "./outline-tree-edit-contract.js";
import type { OutlineEditPosition, OutlineRowViewModel } from "./outline-tree-view-model.js";

export type OutlineSelectionOperation = "indent" | "outdent" | "reorder-up" | "reorder-down";
export type OutlineNodeKeyboardContext = Readonly<{
  rows: readonly OutlineRowViewModel[];
  cursorKey: string | null;
  selection: OutlineSelection;
  select: (selection: OutlineSelection) => void;
  activate: (position: OutlineEditPosition) => void;
  move: (keys: readonly string[], operation: OutlineSelectionOperation) => void;
  remove: (keys: readonly string[]) => void;
  duplicate: (keys: readonly string[]) => void;
  toggle: (key: string) => void;
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
  if (modified && !event.altKey && event.key === "Enter") {
    roots.forEach(context.toggle);
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
