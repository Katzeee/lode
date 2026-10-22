import { useRef, type RefObject } from "react";
import { nodeEditorBinding } from "./node-editor-binding.js";
import { useNodeEditSession } from "./node-edit-session.js";

import { contentLength, type OutlineContent } from "./outline-content.js";
import {
  resolveEditInsertion,
  type OutlineEditPosition,
  type OutlineMove,
  type OutlineMoveResult,
  type OutlineInsertionPlacement,
  type OutlineRowViewModel,
} from "./outline-tree-view-model.js";
import {
  dispatchEditIntent,
  insertFromEditor,
  positionAfterDisclosure,
  resumeTyping,
  type OutlineEditIntentContext,
} from "./outline-edit-intents.js";
import type { OutlineEditorCommand, OutlineTreeEditing, OutlineTextKeyContext } from "./outline-tree-edit-contract.js";

type EditOptions = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  editing?: OutlineTreeEditing;
  onCursorChange: (key: string) => void;
  onTextInput: () => void;
  onKeyDown: (event: KeyboardEvent, context: OutlineTextKeyContext) => boolean;
  onExecuteCommand: (id: string, content: OutlineContent) => boolean | OutlineEditPosition;
  canExecuteCommand: (id: string) => boolean;
  onMove?: (move: OutlineMove) => OutlineMoveResult | null;
  onExpandedChange: (key: string, expanded: boolean) => void;
  onDeleteSelection?: (keys: readonly string[]) => void;
  rows: readonly OutlineRowViewModel[];
  scrollToKey: (key: string) => void;
}>;

export function useOutlineEdit({
  containerRef,
  editing,
  onCursorChange,
  onTextInput,
  onKeyDown,
  onExecuteCommand,
  canExecuteCommand,
  onMove,
  onExpandedChange,
  onDeleteSelection,
  rows,
  scrollToKey,
}: EditOptions) {
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const editSession = useNodeEditSession({
    containerRef,
    editing,
    onCursorChange,
    onTextInput,
    targets: rows.map((row) => row.item),
    scrollToKey,
  });
  const {
    navigateOutside,
    session,
    getPosition,
    endPreviousEdit,
    sessionRef,
    editingRef,
    lastPositionRef,
    setPending,
    commit,
    activate,
    activatePosition,
    navigateTo,
    commitAndExit,
    history,
  } = editSession;

  const startAtEnd = (row: OutlineRowViewModel, appendedText = "") => {
    if (editing === undefined || row.item.editable === false) {
      return;
    }
    endPreviousEdit(row.key);
    setPending(null);
    const remembered = lastPositionRef.current?.key === row.key ? lastPositionRef.current : null;
    const resumed = resumeTyping(row.item.content, remembered, appendedText);
    activate(row.item, resumed.content, resumed.caret);
  };

  const startAtCaret = (row: OutlineRowViewModel, caret: number, selectionEnd = caret) => {
    if (editing === undefined || row.item.editable === false) {
      return;
    }
    endPreviousEdit(row.key);
    setPending(null);
    const content = row.item.content;
    activate(row.item, content, caret, selectionEnd);
  };

  const createChild = (parent: OutlineRowViewModel) => {
    const activeEditing = editingRef.current;
    if (activeEditing?.onCreateChild === undefined || parent.item.capabilities?.insertChildren === false) {
      return;
    }
    const position = activeEditing.onCreateChild(parent.key);
    setPending(
      position
        ? { type: "position", position }
        : {
            type: "resolve",
            resolve: () =>
              resolveEditInsertion(rowsRef.current, { displacedKey: null, indexInParent: 0, parentKey: parent.key }),
          },
    );
  };

  const setExpanded = (key: string, expanded: boolean) => {
    const current = sessionRef.current;
    const resting = document.activeElement === containerRef.current ? lastPositionRef.current : null;
    const position = positionAfterDisclosure(
      rows,
      key,
      expanded,
      current === null ? resting : { key: current.key, caret: 0 },
    );
    if (position !== null && (current === null || position.key !== current.key)) {
      if (current !== null) {
        commit(current.key, current.content);
      }
      activatePosition(position);
    }
    onExpandedChange(key, expanded);
  };

  const intentContext = (): OutlineEditIntentContext => ({
    editing: editingRef.current,
    rows,
    commit,
    activate: (position, content) => {
      if (rowsRef.current.some((row) => row.key === position.key)) {
        activatePosition(position, content);
      } else {
        setPending({ type: "position", position, content });
      }
    },
    remove: onDeleteSelection,
    exit: commitAndExit,
    expand: setExpanded,
    insert: (insertion) =>
      setPending({ type: "resolve", resolve: () => resolveEditInsertion(rowsRef.current, insertion) }),
    boundary: navigateOutside,
  });

  const restructure = (key: string, command: Extract<OutlineEditorCommand, { type: "structure" }>) => {
    if (onMove === undefined) {
      return false;
    }
    if (rows.some((row) => row.key === key && row.item.capabilities?.move !== false)) {
      commit(key, command.content);
      const result = onMove({ kind: "relative", sourceKeys: [key], operation: command.operation });
      if (result !== null) {
        setPending({
          type: "position",
          position: {
            key: result.keyMap.get(key) ?? key,
            caret: command.caret,
            selectionEnd: command.selectionEnd,
            preserveSelection: true,
          },
        });
      }
    }
    return true;
  };

  const handleCommand = (key: string, command: OutlineEditorCommand): boolean => {
    if (sessionRef.current?.key !== key) {
      return false;
    }
    const object = rows.find((row) => row.key === key)?.item.activation === "object";
    if (object && command.type === "enter" && command.placement === undefined) {
      commit(key, command.content);
      commitAndExit();
      containerRef.current?.focus({ preventScroll: true });
      return true;
    }
    if (object && (command.type === "backspace" || command.type === "delete-forward")) {
      return true;
    }
    if (command.type === "history") {
      return history(command.direction);
    }
    if (command.type !== "navigate" && command.type !== "disclosure") {
      editingRef.current?.history?.checkpoint(lastPositionRef.current, "operation");
    }
    if (command.type === "duplicate") {
      if (rows.find((row) => row.key === key)?.item.capabilities?.insertSiblings === false) {
        return true;
      }
      const position = editingRef.current?.onDuplicate?.([key]);
      if (position != null) {
        setPending({ type: "position", position });
      }
      return true;
    }
    return command.type === "structure" ? restructure(key, command) : dispatchEditIntent(intentContext(), key, command);
  };

  const binding = nodeEditorBinding(editSession, {
    editing,
    canExecuteCommand,
    onKeyDown,
    onExecuteCommand,
    onTextInput,
    onCursorChange,
    onCommand: (command) => (session === null ? false : handleCommand(session.key, command)),
    focusContainer: () => containerRef.current?.focus({ preventScroll: true }),
  });

  return {
    claimFocus: editSession.claimFocus,
    navigateOutside,
    activeKey: binding === null ? null : (session?.key ?? null),
    binding,
    commitAndExit,
    createChild,
    setExpanded,
    history,
    getPosition,
    restore: (position: OutlineEditPosition) => setPending({ type: "position", position }),
    getActivePosition: editSession.getActivePosition,
    commit: () => {
      const current = sessionRef.current;
      if (current !== null) {
        commit(current.key, current.content);
      }
    },
    selectText: (from: number, to: number) => {
      const current = sessionRef.current;
      const row = rows.find((candidate) => candidate.key === current?.key);
      if (current !== null && row !== undefined) {
        activate(row.item, current.content, from, to);
      }
    },
    remapPosition: (mapping: ReadonlyMap<string, string>) => {
      const position = lastPositionRef.current;
      if (position !== null) {
        lastPositionRef.current = { ...position, key: mapping.get(position.key) ?? position.key };
      }
    },
    enterFromSelection: (row: OutlineRowViewModel, forced?: OutlineInsertionPlacement) => {
      const position = lastPositionRef.current?.key === row.key ? lastPositionRef.current : null;
      const caret = position?.caret ?? contentLength(row.item.content);
      return insertFromEditor(
        intentContext(),
        row.key,
        row.item.content,
        caret,
        position?.selectionEnd ?? caret,
        forced,
      );
    },
    navigateTo,
    startAtCaret,
    startAtEnd,
  };
}
