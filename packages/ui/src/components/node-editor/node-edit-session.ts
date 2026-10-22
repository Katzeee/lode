import { sourceSelection } from "./outline-caret.js";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { contentLength, type OutlineContent } from "./outline-content.js";
import type { OutlineEditPosition } from "./outline-tree-view-model.js";
import type { NodeEditing, NodeEditTarget } from "./node-editing.js";
import { useNodeEditorCoordinator } from "./node-editor.js";

type EditSession = Readonly<{
  ariaLabel: string;
  content: OutlineContent;
  key: string;
  revision: number;
  submitted: boolean;
}>;
type PendingActivation =
  | Readonly<{ resolve: () => OutlineEditPosition | null; type: "resolve" }>
  | Readonly<{ position: OutlineEditPosition; content?: OutlineContent; type: "position" }>;

type SessionOptions<Editing extends NodeEditing> = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  editing?: Editing;
  onCursorChange: (key: string) => void;
  onTextInput: () => void;
  targets: readonly NodeEditTarget[];
  scrollToKey: (key: string) => void;
}>;

export function useNodeEditSession<Editing extends NodeEditing>({
  containerRef,
  editing,
  onCursorChange,
  onTextInput,
  targets,
  scrollToKey,
}: SessionOptions<Editing>) {
  const coordinator = useNodeEditorCoordinator();
  const areaId = useId();
  const [session, setSessionState] = useState<EditSession | null>(null);
  const [pending, setPending] = useState<PendingActivation | null>(null);
  const lastPositionRef = useRef<OutlineEditPosition | null>(null);
  const sessionRef = useRef(session);
  const revisionRef = useRef(0);
  const editingRef = useRef(editing);
  const desiredCaretRef = useRef(0);
  const desiredSelectionEndRef = useRef(0);
  const requestRevisionRef = useRef(0);
  editingRef.current = editing;

  const recordInteraction = () => {
    requestRevisionRef.current++;
    // A completed request can still be waiting for its target to render.
    // Later input supersedes that queued focus as well as any in-flight response.
    setPending(null);
    coordinator.cancel(areaId);
  };

  const setSession = (next: EditSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
  };

  const commit = useCallback((key: string, content: OutlineContent, reason: "blur" | "operation" = "operation") => {
    const current = sessionRef.current;
    if (current?.key !== key || (reason === "blur" && current.submitted)) {
      return;
    }
    // A structural operation may replace this source before another region takes
    // focus. Its submitted version must not be replayed by the old editor's blur.
    sessionRef.current = { ...current, content, submitted: true };
    editingRef.current?.onContentCommit(key, content, reason);
  }, []);

  const activate = (
    target: NodeEditTarget,
    content: OutlineContent,
    caret: number,
    selectionEnd = caret,
    preserveSelection = false,
  ) => {
    recordInteraction();
    coordinator.claim(areaId);
    if (!preserveSelection) {
      onTextInput();
    }
    desiredCaretRef.current = Math.min(caret, contentLength(content));
    desiredSelectionEndRef.current = Math.min(selectionEnd, contentLength(content));
    onCursorChange(target.key);
    scrollToKey(target.key);
    setSession({
      ariaLabel: `Edit ${target.accessibilityLabel}`,
      content,
      key: target.key,
      revision: ++revisionRef.current,
      submitted: false,
    });
  };

  const endPreviousEdit = (nextKey: string) => {
    const previous = sessionRef.current;
    if (previous && previous.key !== nextKey) {
      commit(previous.key, previous.content, "blur");
    }
  };
  const activatePosition = (position: OutlineEditPosition, predictedContent?: OutlineContent) => {
    if (predictedContent === undefined) {
      endPreviousEdit(position.key);
    }
    const target = targets.find((candidate) => candidate.key === position.key);
    const activeEditing = editingRef.current;
    if (target !== undefined && activeEditing !== undefined) {
      if (
        position.editing === false ||
        target.editable === false ||
        (target.activation === "object" &&
          position.editing !== true &&
          sessionRef.current?.key !== target.key &&
          predictedContent === undefined)
      ) {
        coordinator.claim(areaId);
        if (!position.preserveSelection) {
          onTextInput();
        }
        lastPositionRef.current = { ...position, editing: false };
        onCursorChange(target.key);
        scrollToKey(target.key);
        setSession(null);
        containerRef.current?.focus({ preventScroll: true });
        return true;
      }
      activate(
        target,
        predictedContent ?? target.content,
        position.caret,
        position.selectionEnd,
        position.preserveSelection,
      );
      return true;
    }
    return false;
  };

  useLayoutEffect(() => {
    if (editing?.focusRequest !== undefined) {
      setPending({ type: "position", position: editing.focusRequest });
    }
  }, [editing?.focusRequest]);

  // The inserted row must take over the editor in the same paint that reveals
  // it; a passive effect would leave the editor on the old row for a frame.
  useLayoutEffect(() => {
    if (pending === null || editing === undefined) {
      return;
    }
    const position = pending.type === "position" ? pending.position : pending.resolve();
    const target = position === null ? undefined : targets.find((candidate) => candidate.key === position.key);
    if (position === null) {
      return;
    }
    if (target === undefined) {
      setPending(null);
      coordinator.requestFocus(areaId, position, pending.type === "position" ? pending.content : undefined);
      return;
    }
    setPending(null);
    desiredCaretRef.current = position.caret;
    desiredSelectionEndRef.current = position.selectionEnd ?? position.caret;
    coordinator.claim(areaId);
    if (!position.preserveSelection) {
      onTextInput();
    }
    onCursorChange(target.key);
    scrollToKey(target.key);
    if (
      position.editing === false ||
      target.editable === false ||
      (position.editing !== true && target.activation === "object")
    ) {
      lastPositionRef.current = { ...position, editing: false };
      setSession(null);
      containerRef.current?.focus({ preventScroll: true });
      return;
    }
    setSession({
      ariaLabel: `Edit ${target.accessibilityLabel}`,
      content: pending.type === "position" ? (pending.content ?? target.content) : target.content,
      key: target.key,
      revision: ++revisionRef.current,
      submitted: false,
    });
  }, [editing, onCursorChange, pending, targets, scrollToKey]);

  useEffect(() => {
    if (editing === undefined && sessionRef.current !== null) {
      setPending(null);
      setSession(null);
    }
  }, [editing]);

  const commitAndExit = useCallback(() => {
    requestRevisionRef.current++;
    coordinator.cancel(areaId);
    const current = sessionRef.current;
    if (current !== null) {
      commit(current.key, current.content, "blur");
    }
    setPending(null);
    setSession(null);
  }, [coordinator, areaId, commit]);

  const getPosition = () => {
    const current = sessionRef.current;
    const element = [...(containerRef.current?.querySelectorAll<HTMLElement>('[data-ui="outline-editor"]') ?? [])].find(
      (candidate) => candidate.closest<HTMLElement>("[data-item-key]")?.dataset.itemKey === current?.key,
    );
    const selection =
      element && current?.key === element.closest<HTMLElement>("[data-item-key]")?.dataset.itemKey
        ? sourceSelection(element)
        : null;
    if (selection && current) {
      lastPositionRef.current = { key: current.key, caret: selection.from, selectionEnd: selection.to, editing: true };
    }
    return lastPositionRef.current;
  };

  const history = (direction: "undo" | "redo") => {
    const capability = editingRef.current?.history;
    if (capability === undefined) {
      return false;
    }
    recordInteraction();
    coordinator.claim(areaId);
    const requestRevision = requestRevisionRef.current;
    const result = capability[direction](getPosition());
    const finish = (result: Readonly<{ position: OutlineEditPosition | null }> | null) => {
      if (result !== null && requestRevision === requestRevisionRef.current && coordinator.isActive(areaId)) {
        onTextInput();
        const position = result.position;
        if (position !== null) {
          // Keep the same editor mounted when history restores this Node. A refocus
          // lets the browser mistake an immediate Home selection for a focus reset.
          setPending({ type: "position", position });
        } else {
          setPending(null);
          setSession(null);
          containerRef.current?.focus({ preventScroll: true });
        }
      }
    };
    if (result !== null && "then" in result) {
      void result.then(finish, () => undefined);
    } else {
      finish(result);
    }
    return true;
  };

  const area = useRef({ targets, activatePosition, commitAndExit, onTextInput });
  area.current = { targets, activatePosition, commitAndExit, onTextInput };
  useLayoutEffect(
    () =>
      coordinator.register(areaId, {
        element: () => containerRef.current,
        keys: () => area.current.targets.map((target) => target.key),
        focus: (position, content) => area.current.activatePosition(position, content),
        enter: () => {
          area.current.onTextInput();
          containerRef.current?.focus({ preventScroll: true });
        },
        end: () => {
          area.current.commitAndExit();
          area.current.onTextInput();
        },
      }),
    [coordinator, areaId, containerRef],
  );
  useLayoutEffect(() => coordinator.refresh());

  return {
    recordInteraction,
    claimFocus: () => {
      recordInteraction();
      coordinator.claim(areaId);
    },
    navigateOutside: (direction: -1 | 1) => coordinator.adjacent(areaId, direction),
    getPosition,
    getActivePosition: () =>
      coordinator.isActive(areaId) &&
      (sessionRef.current !== null || containerRef.current?.contains(document.activeElement))
        ? getPosition()
        : null,
    endPreviousEdit,
    history,
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
    navigateTo: (position: OutlineEditPosition) => {
      const current = sessionRef.current;
      if (current) {
        commit(current.key, current.content);
      }
      if (!activatePosition(position)) {
        coordinator.requestFocus(areaId, position);
      }
    },
    commitAndExit,
  };
}
