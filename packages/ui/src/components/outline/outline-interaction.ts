import { useMemo, useState, type KeyboardEvent, type RefObject } from "react";

import { contentLength } from "./outline-content.js";
import type { OutlineContent } from "./outline-content.js";
import { outlineClipboard } from "./outline-clipboard.js";
import { outlineCommandForKey, outlineCommandDispatcher, type OutlineHostCommand } from "./outline-commands.js";
import { discloseOutline } from "./outline-edit-intents.js";
import { handleOutlineNodeKey, type OutlineSelectionOperation } from "./outline-node-keyboard.js";
import { outlineMovement } from "./outline-movement.js";
import { useOutlinePointer } from "./outline-pointer.js";
import {
  emptyOutlineSelection,
  normalizeOutlineSelection,
  selectedOutlineRoots,
  type OutlineSelection,
} from "./outline-selection.js";
import { useOutlineEdit } from "./outline-tree-edit.js";
import type { OutlineTextKeyContext, OutlineTreeEditing } from "./outline-tree-edit-contract.js";
import {
  computeIndent,
  computeOutdent,
  computeReorder,
  type OutlineMove,
  type OutlineMoveResult,
  type OutlineRowViewModel,
} from "./outline-tree-view-model.js";

type InteractionOptions = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  rows: readonly OutlineRowViewModel[];
  editing?: OutlineTreeEditing;
  selection?: OutlineSelection;
  onSelectionChange?: (selection: OutlineSelection) => void;
  onMove?: (move: OutlineMove) => OutlineMoveResult | null | Promise<OutlineMoveResult | null>;
  onDeleteSelection?: (keys: readonly string[]) => void;
  onExpandedChange: (key: string, expanded: boolean) => void;
  scrollToKey: (key: string) => void;
  onActivate: (row: OutlineRowViewModel) => void;
  commands?: readonly OutlineHostCommand[];
}>;

export function useOutlineInteraction(options: InteractionOptions) {
  const { rows, editing, containerRef, onExpandedChange, onDeleteSelection, onMove, scrollToKey } = options;
  const [internalSelection, setInternalSelection] = useState<OutlineSelection>(emptyOutlineSelection);
  const [storedCursorKey, setCursorKey] = useState<string | null>(null);
  const cursorKey = rows.some((row) => row.key === storedCursorKey) ? storedCursorKey : null;
  const selection = useMemo(
    () => normalizeOutlineSelection(rows, options.selection ?? internalSelection),
    [rows, options.selection, internalSelection],
  );
  const select = (next: OutlineSelection) => {
    if (options.selection === undefined) {
      setInternalSelection(next);
    }
    options.onSelectionChange?.(next);
  };
  const applyMove = outlineMovement({
    onMove,
    expand: onExpandedChange,
    selection,
    cursorKey,
    select,
    setCursor: setCursorKey,
    remap: (mapping) => edit.remapPosition(mapping),
    position: () => edit.getPosition(),
    restore: (position) => edit.restore(position),
  });
  const edit = useOutlineEdit({
    containerRef,
    editing,
    onCursorChange: setCursorKey,
    onTextInput: () => select(emptyOutlineSelection),
    onExpandedChange,
    onDeleteSelection,
    rows,
    scrollToKey,
    onKeyDown: (event, context) => handleNodeKey(event, context),
    onExecuteCommand: (id, content) => dispatchCommand(id, "completion", undefined, content),
    canExecuteCommand: (id) => canExecuteCommand(id, undefined, "completion"),
    onMove: onMove === undefined ? undefined : applyMove,
  });

  const moveTo = (move: OutlineMove) => {
    const position = edit.getPosition();
    editing?.history?.checkpoint(position, "operation");
    edit.commit();
    const result = applyMove(move);
    if (result !== null && position !== null && edit.activeKey !== null) {
      edit.restore({ ...position, key: result.keyMap.get(position.key) ?? position.key });
    }
  };
  const move = (keys: readonly string[], operation: OutlineSelectionOperation) => {
    const intent =
      operation === "indent"
        ? computeIndent(rows, keys)
        : operation === "outdent"
          ? computeOutdent(rows, keys)
          : computeReorder(rows, keys, operation === "reorder-up" ? -1 : 1);
    if (intent !== null) {
      moveTo(intent);
    }
  };
  const remove = (keys: readonly string[]) => {
    if (onDeleteSelection === undefined) {
      return;
    }
    editing?.history?.checkpoint(edit.getPosition(), "operation");
    const removed = new Set<string>();
    for (const row of rows) {
      if (keys.includes(row.key) || (row.parentKey !== null && removed.has(row.parentKey))) {
        removed.add(row.key);
      }
    }
    const first = rows.findIndex((row) => removed.has(row.key));
    const last = rows.reduce((last, row, index) => (removed.has(row.key) ? index : last), -1);
    const next = rows[last + 1] ?? rows[first - 1];
    edit.commitAndExit();
    onDeleteSelection(keys);
    select(emptyOutlineSelection);
    setCursorKey(next?.key ?? null);
    if (next !== undefined) {
      edit.startAtCaret(next, 0);
    } else {
      containerRef.current?.focus({ preventScroll: true });
    }
  };
  const expand = (key: string, expanded: boolean) => {
    select(emptyOutlineSelection);
    edit.setExpanded(key, expanded);
  };
  const activate = (row: OutlineRowViewModel, caret: number) => {
    select(emptyOutlineSelection);
    setCursorKey(row.key);
    edit.startAtCaret(row, caret);
    scrollToKey(row.key);
  };
  const { execute: dispatchCommand, canExecute: canExecuteCommand } = outlineCommandDispatcher({
    commands: options.commands ?? [],
    rows,
    selectedKeys: selectedOutlineRoots(rows, selection.keys),
    cursorKey,
    getPosition: edit.getPosition,
    checkpoint: (position) => editing?.history?.checkpoint(position, "operation"),
    restore: edit.restore,
  });
  const executeCommand = (...args: Parameters<typeof dispatchCommand>) => dispatchCommand(...args) !== false;
  const handleNodeKey = (event: KeyboardEvent | globalThis.KeyboardEvent, context: OutlineTextKeyContext) => {
    const command = outlineCommandForKey(options.commands ?? [], event);
    if (command !== undefined && executeCommand(command.id, "keyboard", undefined, context.content)) {
      return true;
    }
    return handleOutlineNodeKey(event, context, {
      rows,
      cursorKey: cursorKey ?? selection.focusKey ?? rows[0]?.key ?? null,
      selection,
      select,
      move,
      remove,
      duplicate: (keys) => {
        editing?.history?.checkpoint(edit.getPosition(), "operation");
        const position = editing?.onDuplicate?.(keys);
        if (position != null) {
          select(emptyOutlineSelection);
          edit.restore(position);
        }
      },
      expand: edit.setExpanded,
      activate: (position) => {
        const row = rows.find((candidate) => candidate.key === position.key);
        if (row !== undefined) {
          activate(row, position.caret);
        }
      },
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) {
      return;
    }
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
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key.length === 1 || event.key === "Enter") &&
        editing?.onCreateRoot !== undefined
      ) {
        event.preventDefault();
        createRoot(event.key === "Enter" ? [] : [{ type: "text", text: event.key }]);
      }
      return;
    }
    const position = edit.getPosition();
    const text = {
      content: cursor.item.content,
      atTop: true,
      atBottom: true,
      from: position?.key === cursor.key ? position.caret : contentLength(cursor.item.content),
      to: position?.key === cursor.key ? (position.selectionEnd ?? position.caret) : contentLength(cursor.item.content),
    };
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
        options.onActivate(cursor);
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
      const position = editing?.onClearAppearance?.(cursor.key);
      if (position) {
        edit.restore(position);
      }
    } else if (cursor.item.activation === "object" && event.key === " ") {
      options.onActivate(cursor);
    } else if (!modified && !event.altKey && event.key.startsWith("Arrow")) {
      const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
      const target = rows[rows.indexOf(cursor) + direction];
      if (target !== undefined) {
        activate(target, event.key === "ArrowLeft" ? contentLength(target.item.content) : 0);
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
  };
  const mouseDown = useOutlinePointer({ containerRef, rows, edit, selection, select, cursor: setCursorKey });
  const createRoot = (content: OutlineContent = []) => {
    editing?.history?.checkpoint(null, "operation");
    const position = editing?.onCreateRoot?.(content);
    if (position !== undefined) {
      edit.restore(position);
    }
  };
  const roots = selectedOutlineRoots(rows, selection.keys);
  const clipboard = outlineClipboard({
    rows,
    roots,
    editing,
    edit,
    cursorKey,
    clear: () => select(emptyOutlineSelection),
    remove,
  });
  return {
    executeCommand,
    canExecuteCommand,
    clipboard,
    createRoot,
    edit,
    selection,
    cursorKey,
    handleKeyDown,
    mouseDown,
    moveTo,
    expand,
    clearSelection: () => select(emptyOutlineSelection),
    moveSelected: (operation: OutlineSelectionOperation) => move(roots, operation),
    deleteSelected: () => remove(roots),
  };
}
