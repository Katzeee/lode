import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "../cn.js";
import { Icon } from "../icon.js";
import type { ResolvedOutlineBulletPresentation } from "./outline-presentation.js";
import type { OutlineRowViewModel } from "./outline-tree-view-model.js";

export function OutlineSelectionToolbar({
  count,
  onDelete,
  onMove,
}: Readonly<{
  count: number;
  onDelete?: () => void;
  onMove?: (operation: "indent" | "outdent" | "reorder-down" | "reorder-up") => void;
}>) {
  const actionClass =
    "grid size-7 place-items-center rounded-sm text-label text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/45";
  return (
    <div
      aria-label={`${String(count)} items selected`}
      className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      data-ui="outline-selection-toolbar"
      onClick={(event) => event.stopPropagation()}
      role="toolbar"
    >
      <span className="px-2 text-caption font-medium tabular-nums">{String(count)} selected</span>
      {onMove === undefined ? null : (
        <>
          <button
            aria-label="Outdent selected items"
            className={actionClass}
            onClick={() => onMove("outdent")}
            type="button"
          >
            ←
          </button>
          <button
            aria-label="Indent selected items"
            className={actionClass}
            onClick={() => onMove("indent")}
            type="button"
          >
            →
          </button>
          <button
            aria-label="Move selected items up"
            className={actionClass}
            onClick={() => onMove("reorder-up")}
            type="button"
          >
            ↑
          </button>
          <button
            aria-label="Move selected items down"
            className={actionClass}
            onClick={() => onMove("reorder-down")}
            type="button"
          >
            ↓
          </button>
        </>
      )}
      {onDelete === undefined ? null : (
        <button aria-label="Delete selected items" className={actionClass} onClick={onDelete} type="button">
          <Icon className="size-3.5" name="trash" />
        </button>
      )}
    </div>
  );
}

export function OutlineRowControls({
  beforeIntent,
  bullet,
  consumeDragClick,
  draggable,
  onDragHandleDown,
  onExpandedChange,
  row,
}: Readonly<{
  beforeIntent: () => void;
  bullet: ResolvedOutlineBulletPresentation;
  consumeDragClick: () => boolean;
  draggable: boolean;
  onDragHandleDown: (event: ReactPointerEvent) => void;
  onExpandedChange: (key: string, expanded: boolean) => void;
  row: OutlineRowViewModel;
}>) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 py-0.5">
      <button
        aria-label={row.expanded ? `Collapse ${row.item.accessibilityLabel}` : `Expand ${row.item.accessibilityLabel}`}
        className={cn(
          "grid size-5 place-items-center rounded-sm text-muted-foreground/70 outline-none transition-[opacity,color,background-color] hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/45 group-hover/outline-row:opacity-100",
          row.expanded ? "opacity-50" : "opacity-0",
          !row.expandable && "invisible",
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
      {bullet.onActivate === undefined ? (
        <span
          aria-hidden
          className={cn(
            "grid size-5 place-items-center rounded-full",
            draggable && "cursor-grab touch-none active:cursor-grabbing",
          )}
          data-ui="outline-bullet"
          onPointerDown={draggable ? onDragHandleDown : undefined}
        >
          {bullet.content}
        </span>
      ) : (
        <button
          aria-label={bullet.accessibilityLabel ?? `Activate ${row.item.accessibilityLabel}`}
          className={cn(
            "grid size-5 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
            draggable && "touch-none active:cursor-grabbing",
          )}
          data-ui="outline-bullet"
          onClick={(event) => {
            event.stopPropagation();
            if (!consumeDragClick()) {
              beforeIntent();
              bullet.onActivate?.();
            }
          }}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={draggable ? onDragHandleDown : undefined}
          tabIndex={-1}
          type="button"
        >
          {bullet.content}
        </button>
      )}
    </span>
  );
}
