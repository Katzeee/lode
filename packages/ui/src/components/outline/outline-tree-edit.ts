import type { RefObject } from "react";
import { bindOutlineCompletionProviders } from "./outline-editor-picker.js";
import { useOutlineEditSession } from "./outline-edit-session.js";

import { contentLength, type OutlineContent } from "./outline-content.js";
import {
  computeIndent,
  computeOutdent,
  computeReorder,
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
import type {
  OutlineEditorBinding,
  OutlineEditorCommand,
  OutlineTreeEditing,
  OutlineTextKeyContext,
} from "./outline-tree-edit-contract.js";

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
  const {
    session,
    sessionRef,
    editingRef,
    lastPositionRef,
    desiredCaretRef,
    desiredSelectionEndRef,
    setSession,
    setPending,
    commit,
    activate,
    activatePosition,
    commitAndExit,
  } = useOutlineEditSession({
    containerRef,
    editing,
    onCursorChange,
    rows,
    scrollToKey,
  });

  const startAtEnd = (row: OutlineRowViewModel, appendedText = "") => {
    if (editing === undefined || row.item.editable === false) {
      return;
    }
    setPending(null);
    const remembered = lastPositionRef.current?.key === row.key ? lastPositionRef.current : null;
    const resumed = resumeTyping(row.item.content, remembered, appendedText);
    activate(row, resumed.content, resumed.caret);
  };

  const startAtCaret = (row: OutlineRowViewModel, caret: number, selectionEnd = caret) => {
    if (editing === undefined || row.item.editable === false) {
      return;
    }
    setPending(null);
    const content = row.item.content;
    activate(row, content, caret, selectionEnd);
  };

  const createChild = (parent: OutlineRowViewModel) => {
    const activeEditing = editingRef.current;
    if (activeEditing?.onCreateChild === undefined) {
      return;
    }
    setPending({ type: "insertion", insertion: { displacedKey: null, indexInParent: 0, parentKey: parent.key } });
    activeEditing.onCreateChild(parent.key);
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
    activate: activatePosition,
    remove: onDeleteSelection,
    exit: commitAndExit,
    expand: setExpanded,
    insert: (insertion) => setPending({ type: "insertion", insertion }),
  });

  const restructure = (key: string, command: Extract<OutlineEditorCommand, { type: "structure" }>) => {
    if (onMove === undefined) {
      return false;
    }
    const move =
      command.operation === "indent"
        ? computeIndent(rows, [key])
        : command.operation === "outdent"
          ? computeOutdent(rows, [key])
          : computeReorder(rows, [key], command.operation === "reorder-up" ? -1 : 1);
    if (move !== null) {
      commit(key, command.content);
      const result = onMove(move);
      if (result !== null) {
        setPending({
          type: "position",
          position: { key: result.keyMap.get(key) ?? key, caret: command.caret, selectionEnd: command.selectionEnd },
        });
      }
    }
    return true;
  };

  const handleCommand = (key: string, command: OutlineEditorCommand): boolean => {
    if (sessionRef.current?.key !== key) {
      return false;
    }
    if (command.type === "history") {
      return history(command.direction);
    }
    if (command.type !== "navigate" && command.type !== "disclosure") {
      editingRef.current?.history?.checkpoint(lastPositionRef.current, "operation");
    }
    if (command.type === "duplicate") {
      const position = editingRef.current?.onDuplicate?.([key]);
      if (position != null) {
        setPending({ type: "position", position });
      }
      return true;
    }
    return command.type === "structure" ? restructure(key, command) : dispatchEditIntent(intentContext(), key, command);
  };

  const history = (direction: "undo" | "redo") => {
    const capability = editingRef.current?.history;
    if (capability === undefined) {
      return false;
    }
    const result = capability[direction](lastPositionRef.current);
    if (result !== null) {
      onTextInput();
      const position = result.position;
      if (position !== null) {
        setPending({ type: "position", position });
      } else {
        setPending(null);
        setSession(null);
        containerRef.current?.focus({ preventScroll: true });
      }
    }
    return true;
  };

  const activeRow = session === null ? undefined : rows.find((row) => row.key === session.key);
  const binding: OutlineEditorBinding | null =
    session === null || editing === undefined
      ? null
      : {
          canExecuteCommand,
          ariaLabel: session.ariaLabel,
          completionProviders: bindOutlineCompletionProviders(editing.completionProviders ?? [], activeRow?.key),
          content: session.content,
          revision: session.revision,
          initialCaret: desiredCaretRef.current,
          initialSelectionEnd: desiredSelectionEndRef.current,
          onBlur: (content, position) => {
            if (sessionRef.current?.key === session.key) {
              lastPositionRef.current = { key: session.key, caret: position.from, selectionEnd: position.to };
              commit(session.key, content);
              setPending(null);
              setSession(null);
            }
          },
          onChange: (content, before, group) => {
            const current = sessionRef.current;
            if (current?.key === session.key) {
              editingRef.current?.history?.checkpoint(
                { key: session.key, caret: before.from, selectionEnd: before.to },
                group,
              );
              sessionRef.current = { ...current, content };
              onCursorChange(session.key);
              onTextInput();
              editingRef.current?.onContentChange(session.key, content);
            }
          },
          onSelectionChange: (position) => {
            lastPositionRef.current = { key: session.key, caret: position.from, selectionEnd: position.to };
          },
          onKeyDown,
          onCommand: (command) => handleCommand(session.key, command),
          onCompletion: (providerId, itemId, content, commandId) => {
            const current = sessionRef.current;
            if (current?.key !== session.key) {
              return;
            }
            sessionRef.current = { ...current, content };
            const provider = editing.completionProviders?.find((candidate) => candidate.id === providerId);
            if (commandId !== undefined) {
              const result = onExecuteCommand(commandId, content);
              if (result !== true) {
                return;
              }
            } else {
              editing.history?.checkpoint(lastPositionRef.current, "operation");
              const position =
                editing.onCompletion === undefined
                  ? editing.onContentChange(session.key, content)
                  : editing.onCompletion(session.key, providerId, itemId, content);
              if (position !== undefined) {
                setPending({ type: "position", position });
                return;
              }
            }
            if (provider?.exitOnSelect === true) {
              setPending(null);
              setSession(null);
              globalThis.requestAnimationFrame(() => containerRef.current?.focus());
            }
          },
          placeholder: editing.emptyPlaceholder ?? "Start typing…",
        };

  return {
    activeKey: binding === null ? null : (session?.key ?? null),
    binding,
    commitAndExit,
    createChild,
    setExpanded,
    history,
    getPosition: () => lastPositionRef.current,
    restore: (position: OutlineEditPosition) => setPending({ type: "position", position }),
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
        activate(row, current.content, from, to);
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
    startAtCaret,
    startAtEnd,
  };
}
