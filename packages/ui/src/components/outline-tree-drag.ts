import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import type { OutlineMove, OutlineRow } from "./outline-tree-model.js";
import { selectedOutlineRoots } from "./outline-selection.js";

// One indent level in pixels; must match the rail width in the row layout.
export const OUTLINE_INDENT = 20;
const DRAG_THRESHOLD = 4;
const EDGE_ZONE = 48;
const EDGE_STEP = 14;
const SPRING_LOAD_DELAY = 550;

export type OutlineDropTarget = Readonly<{
  depth: number;
  move: OutlineMove;
  /** Container-relative Y of the insertion line. */
  y: number;
}>;

export type OutlineDragState = Readonly<{
  pointer: Readonly<{ x: number; y: number }>;
  sourceKeys: readonly string[];
  target: OutlineDropTarget | null;
}>;

type DragOptions<Value> = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  onCommit: (move: OutlineMove) => void;
  onExpandedChange: (key: string, expanded: boolean) => void;
  rows: readonly OutlineRow<Value>[];
  selectedKeys: ReadonlySet<string>;
}>;

export function useOutlineDrag<Value>({
  containerRef,
  enabled,
  onCommit,
  onExpandedChange,
  rows,
  selectedKeys,
}: DragOptions<Value>) {
  const [drag, setDrag] = useState<OutlineDragState | null>(null);
  const session = useRef<{
    pointerId: number;
    sourceKeys: readonly string[];
    springKey: string | null;
    springTimer: number | null;
    startX: number;
    startY: number;
  } | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // A completed drag still fires a click on the handle; the component asks
  // whether to swallow it instead of treating it as bullet activation.
  const suppressClickRef = useRef(false);

  // Hold-near-edge auto scroll: pointermove alone stalls when the pointer
  // rests inside the edge zone, so scrolling runs on its own frame loop.
  useEffect(() => {
    if (drag === null) {
      return;
    }
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    let frame = 0;
    const step = () => {
      const pointer = dragRef.current?.pointer;
      if (pointer !== undefined) {
        if (pointer.y < EDGE_ZONE) {
          window.scrollBy(0, -EDGE_STEP);
        } else if (pointer.y > window.innerHeight - EDGE_ZONE) {
          window.scrollBy(0, EDGE_STEP);
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
    };
  }, [drag !== null]);

  const resolveTarget = (x: number, y: number): OutlineDropTarget | null => {
    const container = containerRef.current;
    const active = session.current;
    if (container === null || active === null) {
      return null;
    }
    const hoveredElement = document
      .elementsFromPoint(x, y)
      .find((candidate) => candidate instanceof HTMLElement && candidate.dataset["ui"] === "outline-row");
    if (!(hoveredElement instanceof HTMLElement)) {
      return null;
    }
    const hoveredIndex = Number(hoveredElement.dataset["index"]);
    const currentRows = rowsRef.current;
    const hovered = currentRows[hoveredIndex];
    if (hovered === undefined) {
      return null;
    }

    scheduleSpringLoad(hovered);

    const rect = hoveredElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const below = y > rect.top + rect.height / 2;
    const gap = hoveredIndex + (below ? 1 : 0);
    const above = currentRows[gap - 1];
    const beneath = currentRows[gap];

    const maxDepth = above === undefined ? 0 : above.depth + 1;
    const minDepth = beneath?.depth ?? 0;
    const desired = Math.round((x - containerRect.left) / OUTLINE_INDENT);
    const depth = Math.max(minDepth, Math.min(maxDepth, desired));

    const move = resolveMove(currentRows, active.sourceKeys, above, depth);
    if (move === null) {
      return null;
    }
    return { depth, move, y: (below ? rect.bottom : rect.top) - containerRect.top };
  };

  const scheduleSpringLoad = (hovered: OutlineRow<Value>) => {
    const active = session.current;
    if (active === null || !hovered.hasChildren || hovered.expanded || active.sourceKeys.includes(hovered.key)) {
      return;
    }
    if (active.springKey === hovered.key) {
      return;
    }
    if (active.springTimer !== null) {
      window.clearTimeout(active.springTimer);
    }
    active.springKey = hovered.key;
    active.springTimer = window.setTimeout(() => onExpandedChange(hovered.key, true), SPRING_LOAD_DELAY);
  };

  const endSession = () => {
    const active = session.current;
    if (active?.springTimer != null) {
      window.clearTimeout(active.springTimer);
    }
    session.current = null;
    setDrag(null);
  };

  const handlePointerDown = (sourceKey: string) => (event: ReactPointerEvent) => {
    if (!enabled || event.button !== 0) {
      return;
    }
    const sourceKeys = selectedKeys.has(sourceKey) ? selectedOutlineRoots(rowsRef.current, selectedKeys) : [sourceKey];
    suppressClickRef.current = false;
    session.current = {
      pointerId: event.pointerId,
      sourceKeys,
      springKey: null,
      springTimer: null,
      startX: event.clientX,
      startY: event.clientY,
    };

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const active = session.current;
      if (active === null || moveEvent.pointerId !== active.pointerId) {
        return;
      }
      const distance = Math.hypot(moveEvent.clientX - active.startX, moveEvent.clientY - active.startY);
      if (dragRef.current === null && distance < DRAG_THRESHOLD) {
        return;
      }
      moveEvent.preventDefault();
      setDrag({
        pointer: { x: moveEvent.clientX, y: moveEvent.clientY },
        sourceKeys: active.sourceKeys,
        target: resolveTarget(moveEvent.clientX, moveEvent.clientY),
      });
    };

    const handleUp = (upEvent: globalThis.PointerEvent) => {
      const active = session.current;
      if (active === null || upEvent.pointerId !== active.pointerId) {
        return;
      }
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      const target = dragRef.current?.target ?? null;
      const wasDragging = dragRef.current !== null;
      endSession();
      if (wasDragging) {
        upEvent.preventDefault();
        suppressClickRef.current = true;
        if (target !== null) {
          onCommit(target.move);
        }
      }
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  const consumeDragClick = () => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  };

  return { consumeDragClick, drag, handlePointerDown };
}

/** Resolve the gap "after `above`, at `depth`" into a concrete move. */
function resolveMove<Value>(
  rows: readonly OutlineRow<Value>[],
  sourceKeys: readonly string[],
  above: OutlineRow<Value> | undefined,
  depth: number,
): OutlineMove | null {
  let move: OutlineMove;
  if (above === undefined) {
    move = { index: 0, sourceKeys, targetParentKey: null };
  } else if (depth === above.depth + 1) {
    move = {
      index: above.expanded ? 0 : (above.occurrence.children?.length ?? 0),
      sourceKeys,
      targetParentKey: above.key,
    };
  } else {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    let sibling: OutlineRow<Value> | undefined = above;
    while (sibling !== undefined && sibling.depth > depth) {
      sibling = sibling.parentKey === null ? undefined : byKey.get(sibling.parentKey);
    }
    if (sibling === undefined) {
      return null;
    }
    move = { index: sibling.indexInParent + 1, sourceKeys, targetParentKey: sibling.parentKey };
  }

  // A subtree cannot land inside itself, and landing beside itself is a no-op.
  if (
    move.targetParentKey !== null &&
    sourceKeys.some(
      (sourceKey) => move.targetParentKey === sourceKey || move.targetParentKey?.startsWith(`${sourceKey}/`) === true,
    )
  ) {
    return null;
  }
  const sources = sourceKeys
    .map((sourceKey) => rows.find((row) => row.key === sourceKey))
    .filter((source): source is OutlineRow<Value> => source !== undefined);
  if (
    sources.length === 1 &&
    move.targetParentKey === sources[0]?.parentKey &&
    (move.index === sources[0]?.indexInParent || move.index === (sources[0]?.indexInParent ?? -1) + 1)
  ) {
    return null;
  }
  return move;
}
