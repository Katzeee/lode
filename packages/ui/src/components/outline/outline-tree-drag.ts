import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import type { OutlineMove, OutlineRowViewModel } from "./outline-tree-view-model.js";
import { selectedOutlineRoots } from "./outline-selection.js";

// One indent level in pixels; must match the rail width in the row layout.
export const OUTLINE_INDENT = 20;
const DRAG_THRESHOLD = 4;
const EDGE_ZONE = 48;
const EDGE_STEP = 14;
const SPRING_LOAD_DELAY = 550;

export function resolveDragDepth(targetDepth: number, targetBulletX: number, pointerX: number): number {
  return targetDepth + Math.round((pointerX - targetBulletX) / OUTLINE_INDENT);
}

// Rows only span their own column, so a pointer over indentation or a label
// column still has to resolve to the row sharing its line; prefer horizontal
// containment, then the nearest row on that line.
function hoveredRowElement(container: HTMLElement, x: number, y: number): HTMLElement | null {
  let nearest: HTMLElement | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const element of container.querySelectorAll<HTMLElement>('[data-ui="outline-row"]')) {
    const rect = element.getBoundingClientRect();
    if (y < rect.top || y >= rect.bottom) {
      continue;
    }
    const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    if (distance < nearestDistance) {
      nearest = element;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export type OutlineDragState = Readonly<{
  pointer: Readonly<{ x: number; y: number }>;
  sourceKeys: readonly string[];
  /** The insertion gap the pointer currently resolves to; its parent's children container draws the line. */
  target: OutlineMove | null;
}>;

type DragOptions = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  onCommit: (move: OutlineMove) => void;
  onExpandedChange: (key: string, expanded: boolean) => void;
  rows: readonly OutlineRowViewModel[];
  selectedKeys: ReadonlySet<string>;
}>;

export function useOutlineDrag({ containerRef, enabled, onCommit, onExpandedChange, rows, selectedKeys }: DragOptions) {
  const [drag, setDrag] = useState<OutlineDragState | null>(null);
  const session = useRef<{
    dragging: boolean;
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
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

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

  const resolveTarget = (x: number, y: number): OutlineMove | null => {
    const container = containerRef.current;
    const active = session.current;
    if (container === null || active === null) {
      return null;
    }
    const hoveredElement = hoveredRowElement(container, x, y);
    if (hoveredElement === null) {
      scheduleSpringLoad(undefined);
      return null;
    }
    const currentRows = rowsRef.current;
    const hoveredIndex = currentRows.findIndex((row) => row.key === hoveredElement.dataset["itemKey"]);
    const hovered = currentRows[hoveredIndex];
    if (hovered === undefined) {
      return null;
    }

    scheduleSpringLoad(hovered);

    const rect = hoveredElement.getBoundingClientRect();
    const targetBullet = hoveredElement.querySelector<HTMLElement>('[data-ui="outline-bullet"]');
    if (targetBullet === null) {
      return null;
    }
    const targetBulletRect = targetBullet.getBoundingClientRect();
    const targetBulletX = targetBulletRect.left + targetBulletRect.width / 2;
    const below = y > rect.top + rect.height / 2;
    const gap = hoveredIndex + (below ? 1 : 0);
    const above = currentRows[gap - 1];
    const beneath = currentRows[gap];

    const maxDepth = above === undefined ? 0 : above.depth + 1;
    const minDepth = beneath?.depth ?? 0;
    const desired = resolveDragDepth(hovered.depth, targetBulletX, x);
    const depth = Math.max(minDepth, Math.min(maxDepth, desired));

    return resolveDropMove(currentRows, active.sourceKeys, above, depth);
  };

  const scheduleSpringLoad = (hovered: OutlineRowViewModel | undefined) => {
    const active = session.current;
    if (active === null) {
      return;
    }
    const key =
      hovered !== undefined && hovered.hasChildren && !hovered.expanded && !active.sourceKeys.includes(hovered.key)
        ? hovered.key
        : null;
    if (active.springKey === key) {
      return;
    }
    if (active.springTimer !== null) {
      window.clearTimeout(active.springTimer);
    }
    active.springKey = key;
    active.springTimer = key === null ? null : window.setTimeout(() => onExpandedChange(key, true), SPRING_LOAD_DELAY);
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
    const source = rowsRef.current.find((row) => row.key === sourceKey);
    if (source === undefined) {
      return;
    }
    cleanupRef.current?.();
    const sourceKeys = selectedKeys.has(sourceKey) ? selectedOutlineRoots(rowsRef.current, selectedKeys) : [sourceKey];
    suppressClickRef.current = false;
    session.current = {
      dragging: false,
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
      if (!active.dragging && distance < DRAG_THRESHOLD) {
        return;
      }
      active.dragging = true;
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
      window.removeEventListener("keydown", cancel, true);
      cleanupRef.current = null;
      const wasDragging = active.dragging;
      const target =
        wasDragging && upEvent.type !== "pointercancel" ? resolveTarget(upEvent.clientX, upEvent.clientY) : null;
      endSession();
      if (wasDragging) {
        upEvent.preventDefault();
        suppressClickRef.current = true;
        if (target !== null) {
          onCommit(target);
        }
      }
    };

    const cancel = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        keyEvent.stopImmediatePropagation();
        suppressClickRef.current = true;
        cleanupRef.current?.();
        endSession();
      }
    };
    cleanupRef.current = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      window.removeEventListener("keydown", cancel, true);
      if (session.current?.springTimer != null) {
        window.clearTimeout(session.current.springTimer);
      }
      session.current = null;
      cleanupRef.current = null;
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    window.addEventListener("keydown", cancel, true);
  };

  const consumeDragClick = () => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  };

  return { consumeDragClick, drag, handlePointerDown };
}

/** Resolve the gap "after `above`, at `depth`" into a concrete move. */
export function resolveDropMove(
  rows: readonly OutlineRowViewModel[],
  sourceKeys: readonly string[],
  above: OutlineRowViewModel | undefined,
  depth: number,
): OutlineMove | null {
  let move: OutlineMove;
  if (above === undefined) {
    move = { index: 0, sourceKeys, targetParentKey: null };
  } else if (depth === above.depth + 1) {
    move = {
      index: above.expanded ? 0 : (above.item.children?.length ?? 0),
      sourceKeys,
      targetParentKey: above.key,
    };
  } else {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    let sibling: OutlineRowViewModel | undefined = above;
    while (sibling !== undefined && sibling.depth > depth) {
      sibling = sibling.parentKey === null ? undefined : byKey.get(sibling.parentKey);
    }
    if (sibling === undefined) {
      return null;
    }
    move = { index: sibling.indexInParent + 1, sourceKeys, targetParentKey: sibling.parentKey };
  }

  // A subtree cannot land inside itself, and landing beside itself is a no-op.
  const byKey = new Map(rows.map((row) => [row.key, row]));
  let ancestorKey = move.targetParentKey;
  while (ancestorKey !== null) {
    if (sourceKeys.includes(ancestorKey)) {
      return null;
    }
    ancestorKey = byKey.get(ancestorKey)?.parentKey ?? null;
  }
  const sources = sourceKeys
    .map((sourceKey) => rows.find((row) => row.key === sourceKey))
    .filter((source): source is OutlineRowViewModel => source !== undefined);
  if (
    sources.length === 1 &&
    move.targetParentKey === sources[0]?.parentKey &&
    (move.index === sources[0]?.indexInParent || move.index === (sources[0]?.indexInParent ?? -1) + 1)
  ) {
    return null;
  }
  return move;
}
