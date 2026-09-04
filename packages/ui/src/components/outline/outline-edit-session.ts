import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { contentLength, type OutlineContent } from "./outline-content.js";
import {
  resolveEditInsertion,
  type OutlineEditInsertion,
  type OutlineEditPosition,
  type OutlineRowViewModel,
} from "./outline-tree-view-model.js";
import type { OutlineTreeEditing } from "./outline-tree-edit-contract.js";

type EditSession = Readonly<{ ariaLabel: string; content: OutlineContent; key: string; revision: number }>;
type PendingActivation =
  | Readonly<{ insertion: OutlineEditInsertion; type: "insertion" }>
  | Readonly<{ position: OutlineEditPosition; type: "position" }>;

type SessionOptions = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  editing?: OutlineTreeEditing;
  onCursorChange: (key: string) => void;
  rows: readonly OutlineRowViewModel[];
  scrollToKey: (key: string) => void;
}>;

export function useOutlineEditSession({ containerRef, editing, onCursorChange, rows, scrollToKey }: SessionOptions) {
  const [session, setSessionState] = useState<EditSession | null>(null);
  const [pending, setPending] = useState<PendingActivation | null>(null);
  const lastPositionRef = useRef<OutlineEditPosition | null>(null);
  const sessionRef = useRef(session);
  const revisionRef = useRef(0);
  const editingRef = useRef(editing);
  const desiredCaretRef = useRef(0);
  const desiredSelectionEndRef = useRef(0);
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

  const activate = (row: OutlineRowViewModel, content: OutlineContent, caret: number, selectionEnd = caret) => {
    desiredCaretRef.current = Math.min(caret, contentLength(content));
    desiredSelectionEndRef.current = Math.min(selectionEnd, contentLength(content));
    onCursorChange(row.key);
    scrollToKey(row.key);
    setSession({
      ariaLabel: `Edit ${row.item.accessibilityLabel}`,
      content,
      key: row.key,
      revision: ++revisionRef.current,
    });
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
      activate(row, predictedContent ?? row.item.content, position.caret, position.selectionEnd);
    }
  };

  // The inserted row must take over the editor in the same paint that reveals
  // it; a passive effect would leave the editor on the old row for a frame.
  useLayoutEffect(() => {
    if (pending === null || editing === undefined) {
      return;
    }
    const position = pending.type === "position" ? pending.position : resolveEditInsertion(rows, pending.insertion);
    const row = position === null ? undefined : rows.find((candidate) => candidate.key === position.key);
    if (position === null || row === undefined) {
      return;
    }
    setPending(null);
    desiredCaretRef.current = position.caret;
    desiredSelectionEndRef.current = position.selectionEnd ?? position.caret;
    onCursorChange(row.key);
    scrollToKey(row.key);
    setSession({
      ariaLabel: `Edit ${row.item.accessibilityLabel}`,
      content: row.item.content,
      key: row.key,
      revision: ++revisionRef.current,
    });
  }, [editing, onCursorChange, pending, rows, scrollToKey]);

  useEffect(() => {
    if (editing === undefined && sessionRef.current !== null) {
      setPending(null);
      setSession(null);
    }
  }, [editing]);

  const commitAndExit = useCallback(() => {
    const current = sessionRef.current;
    if (current !== null) {
      editingRef.current?.onContentCommit(current.key, current.content);
    }
    setPending(null);
    setSession(null);
  }, []);

  return {
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
  };
}
