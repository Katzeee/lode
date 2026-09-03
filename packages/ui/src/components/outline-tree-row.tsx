import type { MouseEvent, PointerEvent, ReactNode } from "react";

import { cn } from "./cn.js";
import type { OutlineEditorBinding, OutlineTreeEditing } from "./outline-tree-edit-contract.js";
import { OutlineInlineEditorProvider } from "./outline-tree-editor.js";
import { OutlineRowControls } from "./outline-tree-controls.js";
import type { OutlineRowLayout } from "./outline-row-layout.js";
import type { OutlineRow } from "./outline-tree-model.js";

export function OutlineTreeRow<Value>({
  consumeDragClick,
  cursor,
  draggable,
  dragged,
  editActiveKey,
  editBinding,
  editing,
  indentDepth,
  layout,
  logicalIndex,
  onCommitAndExit,
  onBulletClick,
  onExpandedChange,
  onPointerDown,
  onRowClick,
  onTextClick,
  renderBullet,
  renderRow,
  row,
  rowDomId,
  selected,
  selectionSize,
  showGuides,
}: Readonly<{
  consumeDragClick: () => boolean;
  cursor: boolean;
  draggable: boolean;
  dragged: boolean;
  editActiveKey: string | null;
  editBinding: OutlineEditorBinding | null;
  editing?: OutlineTreeEditing<Value>;
  indentDepth: number;
  layout: OutlineRowLayout;
  logicalIndex: number;
  onCommitAndExit: () => void;
  onBulletClick?: (row: OutlineRow<Value>, event: MouseEvent<HTMLButtonElement>) => void;
  onExpandedChange: (key: string, expanded: boolean) => void;
  onPointerDown: (event: PointerEvent) => void;
  onRowClick: (event: MouseEvent) => void;
  onTextClick: (event: MouseEvent<HTMLDivElement>) => void;
  renderBullet?: (row: OutlineRow<Value>, state: Readonly<{ selected: boolean }>) => ReactNode;
  renderRow: (row: OutlineRow<Value>) => ReactNode;
  row: OutlineRow<Value>;
  rowDomId: string;
  selected: boolean;
  selectionSize: number;
  showGuides: boolean;
}>) {
  return (
    <div
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-level={row.depth + 1}
      aria-posinset={row.indexInParent + 1}
      aria-selected={selected}
      aria-setsize={row.siblingCount}
      className={cn(
        "group/outline-row flex min-h-8 min-w-0 items-start gap-1 rounded-md py-1 pr-1.5 transition-colors",
        selected && selectionSize > 1 && "bg-primary/12 text-foreground",
        cursor && selectionSize > 1 && "ring-1 ring-inset ring-primary/35",
        dragged && "opacity-40",
      )}
      data-editing={editActiveKey === row.key ? "true" : undefined}
      data-index={logicalIndex}
      data-layout-column={layout.column ?? "single"}
      data-node-id={row.occurrence.nodeId}
      data-occurrence-id={row.occurrence.occurrenceId}
      data-parent-key={row.parentKey ?? undefined}
      data-readonly={editing?.isEditable?.(row) === false ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-ui="outline-row"
      id={rowDomId}
      onClick={onRowClick}
      role="treeitem"
    >
      {Array.from({ length: indentDepth }, (_, level) => (
        <span
          aria-hidden
          className={cn("w-5 shrink-0 self-stretch", showGuides && "ml-2.5 w-2.5 border-l border-border/45")}
          key={level}
        />
      ))}
      <OutlineRowControls
        active={cursor || editActiveKey === row.key}
        beforeIntent={onCommitAndExit}
        consumeDragClick={consumeDragClick}
        draggable={draggable}
        onDragHandleDown={onPointerDown}
        onBulletClick={onBulletClick}
        onExpandedChange={onExpandedChange}
        renderBullet={renderBullet}
        row={row}
        selected={selected && selectionSize > 1}
      />
      <div className="min-w-0 flex-1 text-body leading-5.5">
        {editing === undefined ? (
          renderRow(row)
        ) : (
          <OutlineInlineEditorProvider
            binding={editActiveKey === row.key ? editBinding : null}
            placeholder={
              cursor || editActiveKey === row.key
                ? (editing.emptyPlaceholder ?? "Type / for commands or [[ to link a node…")
                : ""
            }
          >
            <div
              className="flex min-h-6 max-w-full min-w-0 items-start py-0.5"
              data-ui="outline-row-text"
              onClick={onTextClick}
            >
              {renderRow(row)}
            </div>
          </OutlineInlineEditorProvider>
        )}
      </div>
    </div>
  );
}
