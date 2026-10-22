import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import type { OutlineContent } from "./outline-content.js";
import { outlineClipboard } from "./outline-clipboard.js";
import { outlineCommandForKey, outlineCommandDispatcher, type OutlineHostCommand } from "./outline-commands.js";
import {
  handleRestingOutlineKey,
  handleOutlineNodeKey,
  type OutlineSelectionOperation,
} from "./outline-node-keyboard.js";
import { outlineMovement } from "./outline-movement.js";
import { canRemoveOutline } from "./outline-capabilities.js";
import { useOutlinePointer } from "./outline-pointer.js";
import {
  emptyOutlineSelection,
  normalizeOutlineSelection,
  selectedOutlineRoots,
  type OutlineSelection,
} from "./outline-selection.js";
import { useOutlineEdit } from "./outline-tree-edit.js";
import type { OutlineTextKeyContext, OutlineTreeEditing } from "./outline-tree-edit-contract.js";
import { type OutlineMove, type OutlineMoveResult, type OutlineRowViewModel } from "./outline-tree-view-model.js";

type InteractionOptions = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  rows: readonly OutlineRowViewModel[];
  expandedKeys: ReadonlySet<string>;
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
  const movementState = useRef({ expandedKeys: options.expandedKeys, selection, cursorKey: storedCursorKey });
  movementState.current = {
    expandedKeys: options.expandedKeys,
    selection: options.selection ?? internalSelection,
    cursorKey: storedCursorKey,
  };
  const applyMove = outlineMovement({
    rows,
    onMove,
    expand: onExpandedChange,
    state: () => movementState.current,
    select,
    setCursor: setCursorKey,
    remap: (mapping) => edit.remapPosition(mapping),
    position: () => edit.getActivePosition(),
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
      edit.restore({ ...position, key: result.keyMap.get(position.key) ?? position.key, preserveSelection: true });
    }
  };
  const move = (keys: readonly string[], operation: OutlineSelectionOperation) => {
    moveTo({ kind: "relative", sourceKeys: keys, operation });
  };
  const remove = (keys: readonly string[]) => {
    if (onDeleteSelection === undefined || !canRemoveOutline(rows, keys)) {
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
      edit.navigateTo({ key: next.key, caret: 0 });
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
    edit.navigateTo({ key: row.key, caret });
    scrollToKey(row.key);
  };
  const { execute: dispatchCommand, canExecute: canExecuteCommand } = outlineCommandDispatcher({
    commands: options.commands ?? [],
    targets: rows.map((row) => row.item),
    selectedKeys: selectedOutlineRoots(rows, selection.keys),
    cursorKey,
    getPosition: edit.getPosition,
    checkpoint: (position) => editing?.history?.checkpoint(position, "operation"),
    restore: edit.restore,
  });
  const handleNodeKey = (event: KeyboardEvent | globalThis.KeyboardEvent, context: OutlineTextKeyContext) => {
    const command = outlineCommandForKey(options.commands ?? [], event);
    if (command !== undefined && dispatchCommand(command.id, "keyboard", undefined, context.content) !== false) {
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
        if (keys.some((key) => rows.find((row) => row.key === key)?.item.capabilities?.insertSiblings === false)) {
          return;
        }
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
    edit.claimFocus();
    handleRestingOutlineKey(event.nativeEvent, {
      rows,
      cursorKey,
      edit,
      editing,
      createRoot: editing?.onCreateRoot === undefined ? undefined : createRoot,
      handleNodeKey,
      expand,
      move,
      activate,
      select,
      onActivate: options.onActivate,
    });
  };
  const mouseDown = useOutlinePointer({
    containerRef,
    rows,
    edit,
    selection,
    select,
    cursor: setCursorKey,
    onActivate: options.onActivate,
  });
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
    executeCommand: (...args: Parameters<typeof dispatchCommand>) => dispatchCommand(...args) !== false,
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
    canDeleteSelected: canRemoveOutline(rows, roots),
    canMoveSelected:
      roots.length > 0 && roots.every((key) => rows.find((row) => row.key === key)?.item.capabilities?.move !== false),
  };
}
