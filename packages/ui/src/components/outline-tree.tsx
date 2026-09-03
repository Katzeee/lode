import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "./cn.js";
import { Icon } from "./icon.js";
import { OUTLINE_INDENT, useOutlineDrag } from "./outline-tree-drag.js";
import {
  computeIndent,
  computeOutdent,
  computeReorder,
  flattenOutline,
  rowKey,
  type OutlineMove,
  type OutlineNode,
  type OutlineRow,
} from "./outline-tree-model.js";

export type { OutlineMove, OutlineNode, OutlineRow };

type OutlineTreeProperties<Value> = Readonly<{
  expandedKeys: ReadonlySet<string>;
  label: string;
  nodes: readonly OutlineNode<Value>[];
  onExpandedChange: (key: string, expanded: boolean) => void;
  /** Structure edits: keyboard Tab/Shift+Tab indents, Ctrl+Arrow reorders. */
  onMove?: (move: OutlineMove) => void;
  onSelect?: (key: string) => void;
  /** Bullet activation promotes the row to the view root. */
  onZoomIn?: (key: string) => void;
  renderRow: (row: OutlineRow<Value>) => ReactNode;
  showGuides?: boolean;
}>;

export function OutlineTree<Value>({
  expandedKeys,
  label,
  nodes,
  onExpandedChange,
  onMove,
  onSelect,
  onZoomIn,
  renderRow,
  showGuides = true,
}: OutlineTreeProperties<Value>) {
  const treeId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => flattenOutline(nodes, expandedKeys), [nodes, expandedKeys]);
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const cursorIndex = cursorKey === null ? -1 : rows.findIndex((row) => row.key === cursorKey);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 32,
    overscan: 12,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });

  const rowDomId = (key: string) => `${treeId}-${key}`;

  const moveCursor = (index: number) => {
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    setCursorKey(row.key);
    virtualizer.scrollToIndex(index);
  };

  const applyMove = (move: OutlineMove | null) => {
    if (move === null || onMove === undefined) {
      return;
    }
    const source = rows.find((row) => row.key === move.sourceKey);
    // The destination must be visible, or the row would vanish on landing.
    if (move.targetParentKey !== null && !expandedKeys.has(move.targetParentKey)) {
      onExpandedChange(move.targetParentKey, true);
    }
    onMove(move);
    if (source !== undefined) {
      setCursorKey(rowKey(move.targetParentKey, source.node.id));
    }
  };

  const { consumeDragClick, drag, handlePointerDown } = useOutlineDrag({
    containerRef,
    enabled: onMove !== undefined,
    onCommit: applyMove,
    onExpandedChange,
    rows,
  });
  const draggedRow = drag === null ? undefined : rows.find((row) => row.key === drag.sourceKey);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cursor = cursorIndex >= 0 ? rows[cursorIndex] : undefined;
    const structural = onMove !== undefined && (event.ctrlKey || event.metaKey);
    let handled = true;

    if (event.key === "ArrowDown") {
      if (structural && cursor !== undefined) {
        applyMove(computeReorder(rows, cursor.key, 1));
      } else {
        moveCursor(cursorIndex + 1);
      }
    } else if (event.key === "ArrowUp") {
      if (structural && cursor !== undefined) {
        applyMove(computeReorder(rows, cursor.key, -1));
      } else {
        moveCursor(Math.max(0, cursorIndex - 1));
      }
    } else if (event.key === "ArrowRight" && cursor !== undefined) {
      if (cursor.hasChildren && !cursor.expanded) {
        onExpandedChange(cursor.key, true);
      } else if (cursor.hasChildren) {
        moveCursor(cursorIndex + 1);
      }
    } else if (event.key === "ArrowLeft" && cursor !== undefined) {
      if (cursor.expanded) {
        onExpandedChange(cursor.key, false);
      } else if (cursor.parentKey !== null) {
        moveCursor(rows.findIndex((row) => row.key === cursor.parentKey));
      }
    } else if (event.key === "Home") {
      moveCursor(0);
    } else if (event.key === "End") {
      moveCursor(rows.length - 1);
    } else if (event.key === "Enter" && cursor !== undefined) {
      onSelect?.(cursor.key);
    } else if (event.key === "Tab" && onMove !== undefined && cursor !== undefined) {
      applyMove(event.shiftKey ? computeOutdent(rows, cursor.key) : computeIndent(rows, cursor.key));
    } else {
      handled = false;
    }

    if (handled) {
      event.preventDefault();
    }
  };

  return (
    <div
      aria-activedescendant={cursorKey === null ? undefined : rowDomId(cursorKey)}
      aria-label={label}
      className="relative w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      onFocus={() => {
        if (cursorKey === null && rows.length > 0) {
          setCursorKey(rows[0]?.key ?? null);
        }
      }}
      onKeyDown={handleKeyDown}
      ref={containerRef}
      role="tree"
      style={{ height: virtualizer.getTotalSize() }}
      tabIndex={0}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        if (row === undefined) {
          return null;
        }
        return (
          <div
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-level={row.depth + 1}
            aria-posinset={row.indexInParent + 1}
            aria-selected={row.key === cursorKey}
            aria-setsize={row.siblingCount}
            className={cn(
              "absolute inset-x-0 top-0 flex items-start gap-1 rounded-sm py-1 pr-2 transition-colors",
              row.key === cursorKey ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              drag?.sourceKey === row.key && "opacity-40",
            )}
            data-index={item.index}
            data-ui="outline-row"
            id={rowDomId(row.key)}
            key={row.key}
            onClick={() => {
              setCursorKey(row.key);
              onSelect?.(row.key);
            }}
            ref={virtualizer.measureElement}
            role="treeitem"
            style={{ transform: `translateY(${String(item.start - virtualizer.options.scrollMargin)}px)` }}
          >
            {Array.from({ length: row.depth }, (_, level) => (
              <span
                aria-hidden
                className={cn("w-5 shrink-0 self-stretch", showGuides && "border-l border-border/70 ml-2.5 w-2.5")}
                key={level}
              />
            ))}
            <OutlineRowControls
              consumeDragClick={consumeDragClick}
              draggable={onMove !== undefined}
              onDragHandleDown={handlePointerDown(row.key)}
              onExpandedChange={onExpandedChange}
              onZoomIn={onZoomIn}
              row={row}
            />
            <div className="min-w-0 flex-1 pt-0.5 text-body">{renderRow(row)}</div>
          </div>
        );
      })}
      {drag?.target == null ? null : (
        <div
          className="pointer-events-none absolute right-2 z-10 flex items-center"
          style={{ left: drag.target.depth * OUTLINE_INDENT + 6, top: drag.target.y - 4 }}
        >
          <span className="size-2 rounded-full border-2 border-primary" />
          <span className="h-0.5 min-w-0 flex-1 rounded-full bg-primary" />
        </div>
      )}
      {drag === null || draggedRow === undefined ? null : (
        <div
          className="pointer-events-none fixed z-50 max-w-72 rounded-md border border-border bg-popover px-3 py-1.5 text-body text-popover-foreground shadow-lg"
          style={{ left: drag.pointer.x + 14, top: drag.pointer.y + 12 }}
        >
          {renderRow(draggedRow)}
        </div>
      )}
    </div>
  );
}

function OutlineRowControls<Value>({
  consumeDragClick,
  draggable,
  onDragHandleDown,
  onExpandedChange,
  onZoomIn,
  row,
}: Readonly<{
  consumeDragClick: () => boolean;
  draggable: boolean;
  onDragHandleDown: (event: ReactPointerEvent) => void;
  onExpandedChange: (key: string, expanded: boolean) => void;
  onZoomIn?: (key: string) => void;
  row: OutlineRow<Value>;
}>) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 pt-0.5">
      <button
        aria-label={row.expanded ? `Collapse ${row.node.id}` : `Expand ${row.node.id}`}
        className={cn(
          "grid size-5 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/45",
          !row.hasChildren && "invisible",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onExpandedChange(row.key, !row.expanded);
        }}
        onMouseDown={(event) => event.preventDefault()}
        tabIndex={-1}
        type="button"
      >
        <Icon
          className={cn("size-3.5 transition-transform duration-(--lode-duration-fast)", row.expanded && "rotate-90")}
          name="chevron-right"
        />
      </button>
      {onZoomIn === undefined ? (
        <span
          aria-hidden
          className={cn("grid size-5 place-items-center", draggable && "cursor-grab touch-none")}
          data-ui="outline-bullet"
          onPointerDown={draggable ? onDragHandleDown : undefined}
        >
          <OutlineBullet reference={row.node.kind === "reference"} haloed={row.hasChildren && !row.expanded} />
        </span>
      ) : (
        <button
          aria-label={`Open ${row.node.id} as page`}
          className={cn(
            "grid size-5 place-items-center rounded-full outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/45",
            draggable && "cursor-grab touch-none",
          )}
          data-ui="outline-bullet"
          onClick={(event) => {
            event.stopPropagation();
            if (!consumeDragClick()) {
              onZoomIn(row.key);
            }
          }}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={draggable ? onDragHandleDown : undefined}
          tabIndex={-1}
          type="button"
        >
          <OutlineBullet reference={row.node.kind === "reference"} haloed={row.hasChildren && !row.expanded} />
        </button>
      )}
    </span>
  );
}

// The Tana-style bullet: a collapsed node with children wears a soft halo so
// hidden depth stays visible; a reference appearance is hollow because its
// original lives elsewhere.
function OutlineBullet({ haloed, reference }: Readonly<{ haloed: boolean; reference: boolean }>) {
  return (
    <span className={cn("grid size-3 place-items-center rounded-full", haloed && "bg-secondary")}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          reference ? "border border-muted-foreground bg-transparent" : "bg-muted-foreground",
        )}
      />
    </span>
  );
}
