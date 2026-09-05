import type { MouseEvent, PointerEvent } from "react";

import { cn } from "../cn.js";
import type { ResolvedOutlineRowPresentation } from "./outline-presentation.js";
import type { OutlineEditorBinding, OutlineTreeEditing } from "./outline-tree-edit-contract.js";
import { OutlineInlineEditorProvider, OutlineInlineContent } from "./outline-tree-editor.js";
import { OutlineRowControls } from "./outline-tree-controls.js";
import { OutlineRowContent } from "./outline-row.js";
import type { OutlineRowViewModel } from "./outline-tree-view-model.js";

export function OutlineTreeRow({
  consumeDragClick,
  cursor,
  draggable,
  dragged,
  editActiveKey,
  editBinding,
  editing,
  onCommitAndExit,
  onExpandedChange,
  onPointerDown,
  onRowMouseDown,
  row,
  rowDomId,
  presentation,
  selected,
  selectionRoot,
}: Readonly<{
  consumeDragClick: () => boolean;
  cursor: boolean;
  draggable: boolean;
  dragged: boolean;
  editActiveKey: string | null;
  editBinding: OutlineEditorBinding | null;
  editing?: OutlineTreeEditing;
  onCommitAndExit: () => void;
  onExpandedChange: (key: string, expanded: boolean) => void;
  onPointerDown: (event: PointerEvent) => void;
  onRowMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  row: OutlineRowViewModel;
  rowDomId: string;
  presentation: ResolvedOutlineRowPresentation;
  selected: boolean;
  selectionRoot: boolean;
}>) {
  return (
    <div
      aria-description={row.item.editable === false ? row.item.readonlyReason : undefined}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-level={row.depth + 1}
      aria-posinset={row.indexInParent + 1}
      aria-selected={selected}
      aria-setsize={row.siblingCount}
      className={cn(
        "group/outline-row relative flex min-w-0 items-start rounded-selection pr-1.5",
        dragged && "opacity-40",
      )}
      style={{ gap: "var(--lode-outline-gap)", paddingBlock: "var(--lode-outline-row-padding)" }}
      data-object-focused={cursor && row.item.activation === "object" && editActiveKey !== row.key ? "true" : undefined}
      data-editing={editActiveKey === row.key ? "true" : undefined}
      data-item-key={row.key}
      data-parent-key={row.parentKey ?? undefined}
      data-readonly={row.item.editable === false ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-selection-root-row={selectionRoot ? "true" : undefined}
      data-ui="outline-row"
      id={rowDomId}
      onMouseDown={onRowMouseDown}
      role="treeitem"
    >
      <OutlineRowControls
        beforeIntent={onCommitAndExit}
        bullet={presentation.bullet}
        consumeDragClick={consumeDragClick}
        draggable={draggable}
        onDragHandleDown={onPointerDown}
        onExpandedChange={onExpandedChange}
        row={row}
      />
      <div className="min-w-0 flex-1 text-document-body">
        {editing === undefined ? (
          <OutlineItemContent presentation={presentation} row={row} />
        ) : (
          <OutlineInlineEditorProvider
            binding={editActiveKey === row.key ? editBinding : null}
            placeholder={cursor || editActiveKey === row.key ? (editing.emptyPlaceholder ?? "Start typing…") : ""}
          >
            <div className="flex min-h-lh max-w-full min-w-0 items-start" data-ui="outline-row-text">
              <OutlineItemContent presentation={presentation} row={row} />
            </div>
          </OutlineInlineEditorProvider>
        )}
      </div>
    </div>
  );
}

export function OutlineItemContent({
  presentation,
  row,
}: Readonly<{
  presentation: ResolvedOutlineRowPresentation;
  row: OutlineRowViewModel;
}>) {
  const { contentStyle } = presentation;
  return (
    <OutlineRowContent
      className={cn(
        contentStyle?.tone === "muted" && "text-muted-foreground",
        contentStyle?.decoration === "line-through" && "line-through",
      )}
      details={presentation.details}
      leading={presentation.leading}
      prefix={presentation.prefix}
      suffix={presentation.suffix}
      trailing={presentation.trailing}
    >
      <span
        className={cn(
          row.item.editable === false
            ? "lode-outline-readonly"
            : row.item.activation === "object"
              ? "cursor-default"
              : "cursor-text",
          contentStyle?.weight === "medium" && "font-medium",
        )}
        data-ui={row.item.editable === false ? "outline-readonly-text" : undefined}
      >
        <OutlineInlineContent content={row.item.content} />
      </span>
    </OutlineRowContent>
  );
}
