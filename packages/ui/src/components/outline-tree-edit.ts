import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { appendText, contentLength, splitContent, type OutlineContent } from "./outline-content.js";
import {
  computeEditInsertion,
  computeEditMergeTarget,
  computeEditNavigation,
  computeIndent,
  computeOutdent,
  computeReorder,
  resolveEditInsertion,
  type OutlineEditInsertion,
  type OutlineEditPosition,
  type OutlineMove,
  type OutlineRowViewModel,
} from "./outline-tree-view-model.js";
import type { OutlineEditorBinding, OutlineEditorCommand, OutlineTreeEditing } from "./outline-tree-edit-contract.js";

export type {
  OutlineCompletionContext,
  OutlineCompletionItem,
  OutlineCompletionMatch,
  OutlineCompletionProvider,
  OutlineEditorBinding,
  OutlineEditorCommand,
  OutlineTreeEditing,
} from "./outline-tree-edit-contract.js";

type EditSession = Readonly<{ ariaLabel: string; content: OutlineContent; key: string }>;

type EditOptions = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  editing?: OutlineTreeEditing;
  onCursorChange: (key: string) => void;
  onMove?: (move: OutlineMove) => void;
  rows: readonly OutlineRowViewModel[];
  scrollToKey: (key: string) => void;
}>;

export function useOutlineEdit({ containerRef, editing, onCursorChange, onMove, rows, scrollToKey }: EditOptions) {
  const [session, setSessionState] = useState<EditSession | null>(null);
  const [pendingInsertion, setPendingInsertion] = useState<OutlineEditInsertion | null>(null);
  const sessionRef = useRef(session);
  const editingRef = useRef(editing);
  const desiredCaretRef = useRef(0);
  editingRef.current = editing;

  const setSession = (next: EditSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
  };

  const commit = (key: string, content: OutlineContent) => {
    const current = sessionRef.current;
    if (current?.key !== key) {
      return;
    }
    sessionRef.current = { ...current, content };
    editingRef.current?.onContentCommit(key, content);
  };

  const activate = (row: OutlineRowViewModel, content: OutlineContent, caret: number) => {
    desiredCaretRef.current = Math.min(caret, contentLength(content));
    onCursorChange(row.key);
    scrollToKey(row.key);
    setSession({ ariaLabel: `Edit ${row.item.accessibilityLabel}`, content, key: row.key });
  };

  const activatePosition = (position: OutlineEditPosition, predictedContent?: OutlineContent) => {
    const row = rows.find((candidate) => candidate.key === position.key);
    const activeEditing = editingRef.current;
    if (row !== undefined && activeEditing !== undefined) {
      if (row.item.editable === false) {
        onCursorChange(row.key);
        scrollToKey(row.key);
        setSession(null);
        globalThis.requestAnimationFrame(() => containerRef.current?.focus());
        return;
      }
      activate(row, predictedContent ?? row.item.content, position.caret);
    }
  };

  // The inserted row must take over the editor in the same paint that reveals
  // it; a passive effect would leave the editor on the old row for a frame.
  useLayoutEffect(() => {
    if (pendingInsertion === null || editing === undefined) {
      return;
    }
    const position = resolveEditInsertion(rows, pendingInsertion);
    const row = position === null ? undefined : rows.find((candidate) => candidate.key === position.key);
    if (position === null || row === undefined) {
      return;
    }
    setPendingInsertion(null);
    desiredCaretRef.current = 0;
    onCursorChange(row.key);
    scrollToKey(row.key);
    setSession({ ariaLabel: `Edit ${row.item.accessibilityLabel}`, content: row.item.content, key: row.key });
  }, [editing, onCursorChange, pendingInsertion, rows, scrollToKey]);

  useEffect(() => {
    if (editing === undefined && sessionRef.current !== null) {
      setPendingInsertion(null);
      setSession(null);
    }
  }, [editing]);

  const startAtEnd = (row: OutlineRowViewModel, appendedText = "") => {
    if (editing === undefined || row.item.editable === false) {
      return;
    }
    setPendingInsertion(null);
    const content = appendText(row.item.content, appendedText);
    activate(row, content, contentLength(content));
  };

  const startAtCaret = (row: OutlineRowViewModel, caret: number) => {
    if (editing === undefined || row.item.editable === false) {
      return;
    }
    setPendingInsertion(null);
    const content = row.item.content;
    activate(row, content, caret);
  };

  const createChild = (parent: OutlineRowViewModel) => {
    const activeEditing = editingRef.current;
    if (activeEditing?.onCreateChild === undefined) {
      return;
    }
    setPendingInsertion({ displacedKey: null, indexInParent: 0, parentKey: parent.key });
    activeEditing.onCreateChild(parent.key);
  };

  const commitAndExit = useCallback(() => {
    const current = sessionRef.current;
    if (current !== null) {
      editingRef.current?.onContentCommit(current.key, current.content);
    }
    setPendingInsertion(null);
    setSession(null);
  }, []);

  const navigate = (key: string, content: OutlineContent, direction: -1 | 1, caret: number | "end") => {
    const activeEditing = editingRef.current;
    if (activeEditing === undefined) {
      return false;
    }
    const position = computeEditNavigation(rows, key, direction, caret);
    if (position === null) {
      return false;
    }
    commit(key, content);
    activatePosition(position);
    return true;
  };

  const enter = (key: string, content: OutlineContent, from: number, to: number) => {
    const activeEditing = editingRef.current;
    const insertion = computeEditInsertion(rows, key);
    if (activeEditing === undefined || insertion === null) {
      return false;
    }
    commit(key, content);
    setPendingInsertion(insertion);
    if (from === to && to === contentLength(content)) {
      activeEditing.onCreateAfter(key);
      return true;
    }
    const split = splitContent(content, from, to);
    const current = sessionRef.current;
    if (current !== null) {
      setSession({ ...current, content: split.before });
    }
    activeEditing.onSplit(key, split.before, split.after);
    return true;
  };

  const backspace = (key: string, content: OutlineContent) => {
    const activeEditing = editingRef.current;
    if (activeEditing === undefined) {
      return false;
    }
    const previous = computeEditNavigation(rows, key, -1, "end");
    if (previous === null) {
      return false;
    }
    if (contentLength(content) === 0) {
      commit(key, content);
      activeEditing.onDeleteEmpty(key);
      activatePosition(previous);
      return true;
    }
    if (activeEditing.onMerge === undefined) {
      return false;
    }
    const merge = computeEditMergeTarget(rows, key, content);
    const target = merge === null ? undefined : rows.find((row) => row.key === merge.key);
    if (merge === null || target === undefined || target.item.editable === false) {
      return false;
    }
    commit(key, content);
    activeEditing.onMerge({ content: merge.content, sourceKey: key, targetKey: merge.key });
    activatePosition(merge, merge.content);
    return true;
  };

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
      onMove(move);
      setSession(null);
      globalThis.requestAnimationFrame(() => containerRef.current?.focus());
    }
    return true;
  };

  const handleCommand = (key: string, command: OutlineEditorCommand): boolean => {
    if (sessionRef.current?.key !== key) {
      return false;
    }
    if (command.type === "escape") {
      commit(key, command.content);
      setPendingInsertion(null);
      setSession(null);
      globalThis.requestAnimationFrame(() => containerRef.current?.focus());
      return true;
    }
    if (command.type === "enter") {
      return enter(key, command.content, command.from, command.to);
    }
    if (command.type === "backspace") {
      return backspace(key, command.content);
    }
    if (command.type === "navigate") {
      return navigate(key, command.content, command.direction, command.caret);
    }
    return command.type === "structure" ? restructure(key, command) : false;
  };

  const activeRow = session === null ? undefined : rows.find((row) => row.key === session.key);
  const binding: OutlineEditorBinding | null =
    session === null || editing === undefined
      ? null
      : {
          ariaLabel: session.ariaLabel,
          completionProviders:
            activeRow === undefined
              ? []
              : (editing.completionProviders ?? [])
                  .filter((provider) => provider.enabled?.(activeRow.key) !== false)
                  .map(({ enabled: _enabled, ...provider }) => ({
                    ...provider,
                    items: (query: string) => provider.items(activeRow.key, query),
                  })),
          content: session.content,
          initialCaret: desiredCaretRef.current,
          onBlur: (content) => {
            if (sessionRef.current?.key === session.key) {
              commit(session.key, content);
              setPendingInsertion(null);
              setSession(null);
            }
          },
          onChange: (content) => {
            const current = sessionRef.current;
            if (current?.key === session.key) {
              sessionRef.current = { ...current, content };
              editingRef.current?.onContentChange(session.key, content);
            }
          },
          onCommand: (command) => handleCommand(session.key, command),
          onCompletion: (providerId, itemId, content) => {
            const provider = editing.completionProviders?.find((candidate) => candidate.id === providerId);
            editing.onCompletion?.(session.key, providerId, itemId, content);
            if (provider?.exitOnSelect === true) {
              setPendingInsertion(null);
              setSession(null);
              globalThis.requestAnimationFrame(() => containerRef.current?.focus());
            }
          },
          placeholder: editing.emptyPlaceholder ?? "Type / for commands or [[ to link a node…",
        };

  return {
    activeKey: binding === null ? null : (session?.key ?? null),
    binding,
    commitAndExit,
    createChild,
    startAtCaret,
    startAtEnd,
  };
}
