import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { caretOffsetAtPoint } from "./outline-caret.js";
import { OutlineEmptyChild } from "./outline-empty-child.js";
import { OUTLINE_INDENT, useOutlineDrag } from "./outline-tree-drag.js";
import {
  useOutlineEdit,
  type OutlineCompletionContext,
  type OutlineCompletionItem,
  type OutlineCompletionMatch,
  type OutlineCompletionProvider,
  type OutlineTreeEditing,
} from "./outline-tree-edit.js";
import { groupOutlineRows, projectEmptyChildRows, type OutlineRowLayout } from "./outline-row-layout.js";
import { OutlineInlineContent } from "./outline-tree-editor.js";
import { OutlineSelectionToolbar } from "./outline-tree-controls.js";
import { OutlineTreeRow } from "./outline-tree-row.js";
import {
  computeIndent,
  computeOutdent,
  computeReorder,
  flattenOutline,
  rowKey,
  type OutlineMove,
  type OutlineOccurrence,
  type OutlineRow,
} from "./outline-tree-model.js";
import {
  emptyOutlineSelection,
  extendOutlineSelection,
  normalizeOutlineSelection,
  selectOutlineRow,
  selectedOutlineRoots,
  toggleOutlineRow,
  type OutlineSelection,
} from "./outline-selection.js";

export { OutlineInlineContent };
export { OutlineBullet, type OutlineBulletAppearance } from "./outline-bullet.js";
export type { OutlineRowLayout } from "./outline-row-layout.js";
export { OutlineRowContent, OutlineRowProgress, type OutlineRowBadge } from "./outline-row.js";
export type { OutlineContent, OutlineInline, OutlineMark } from "./outline-content.js";
export type {
  OutlineCompletionContext,
  OutlineCompletionItem,
  OutlineCompletionMatch,
  OutlineCompletionProvider,
  OutlineMove,
  OutlineOccurrence,
  OutlineRow,
  OutlineSelection,
  OutlineTreeEditing,
};

type OutlineTreeProperties<Value> = Readonly<{
  editing?: OutlineTreeEditing<Value>;
  expandedKeys: ReadonlySet<string>;
  /** Projects related nodes into visual columns without changing their tree relationship or identity. */
  getRowLayout?: (row: OutlineRow<Value>) => OutlineRowLayout;
  label: string;
  occurrences: readonly OutlineOccurrence<Value>[];
  onExpandedChange: (key: string, expanded: boolean) => void;
  /** Structure edits: Tab/Shift+Tab indents and Ctrl/Cmd+Shift+Arrow reorders the selection atomically. */
  onMove?: (move: OutlineMove) => void;
  onDeleteSelection?: (keys: readonly string[]) => void;
  /** Reports bullet activation with the complete projected Occurrence; navigation belongs to the consumer. */
  onBulletClick?: (row: OutlineRow<Value>, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelect?: (key: string) => void;
  onSelectionChange?: (selection: OutlineSelection) => void;
  /** Replaces the standard solid or reference bullet for typed nodes such as queries, people, or dates. */
  renderBullet?: (row: OutlineRow<Value>, state: Readonly<{ selected: boolean }>) => ReactNode;
  renderRow: (row: OutlineRow<Value>) => ReactNode;
  selection?: OutlineSelection;
  showGuides?: boolean;
}>;

export function OutlineTree<Value>({
  editing,
  expandedKeys,
  getRowLayout,
  label,
  occurrences,
  onDeleteSelection,
  onBulletClick,
  onExpandedChange,
  onMove,
  onSelect,
  onSelectionChange,
  renderBullet,
  renderRow,
  selection,
  showGuides = false,
}: OutlineTreeProperties<Value>) {
  const treeId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => flattenOutline(occurrences, expandedKeys), [occurrences, expandedKeys]);
  const groupedRows = useMemo(() => groupOutlineRows(rows, getRowLayout), [getRowLayout, rows]);
  const supportsEmptyChildren = editing?.onCreateChild !== undefined;
  const visualRows = useMemo(
    () => projectEmptyChildRows(groupedRows, supportsEmptyChildren),
    [groupedRows, supportsEmptyChildren],
  );
  const visualIndexByKey = useMemo(
    () =>
      new Map(
        visualRows.flatMap((visualRow, visualIndex) =>
          visualRow.kind === "nodes"
            ? visualRow.visualRow.entries.map((entry) => [entry.row.key, visualIndex] as const)
            : [],
        ),
      ),
    [visualRows],
  );
  const [internalSelection, setInternalSelection] = useState<OutlineSelection>(emptyOutlineSelection);
  const activeSelection = useMemo(
    () => normalizeOutlineSelection(rows, selection ?? internalSelection),
    [internalSelection, rows, selection],
  );
  const cursorKey = activeSelection.focusKey;
  const cursorIndex = cursorKey === null ? -1 : rows.findIndex((row) => row.key === cursorKey);
  const virtualizer = useWindowVirtualizer({
    count: visualRows.length,
    estimateSize: () => 32,
    getItemKey: (index) => visualRows[index]?.key ?? index,
    overscan: 12,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });

  const rowDomId = (key: string) => `${treeId}-${key}`;

  const commitSelection = (next: OutlineSelection) => {
    if (selection === undefined) {
      setInternalSelection(next);
    }
    onSelectionChange?.(next);
    if (next.focusKey !== null) {
      onSelect?.(next.focusKey);
    }
  };

  const selectOnly = (key: string) => commitSelection(selectOutlineRow(key));

  const requestExpandedChange = (key: string, expanded: boolean) => {
    onExpandedChange(key, expanded);
  };

  const moveCursor = (index: number, extend = false) => {
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    commitSelection(extend ? extendOutlineSelection(rows, activeSelection, row.key) : selectOutlineRow(row.key));
    virtualizer.scrollToIndex(visualIndexByKey.get(row.key) ?? index);
  };

  const applyMove = (move: OutlineMove | null): string | null => {
    if (move === null || onMove === undefined) {
      return null;
    }
    const sources = move.sourceKeys
      .map((sourceKey) => rows.find((row) => row.key === sourceKey))
      .filter((source): source is OutlineRow<Value> => source !== undefined);
    // The destination must be visible, or the row would vanish on landing.
    if (move.targetParentKey !== null && !expandedKeys.has(move.targetParentKey)) {
      onExpandedChange(move.targetParentKey, true);
    }
    onMove(move);
    if (sources.length > 0) {
      const targetKeys = sources.map((source) => rowKey(move.targetParentKey, source.occurrence.occurrenceId));
      const focusSourceIndex = Math.max(0, move.sourceKeys.indexOf(activeSelection.focusKey ?? ""));
      const focusKey = targetKeys[focusSourceIndex] ?? targetKeys.at(-1) ?? null;
      commitSelection({
        anchorKey: targetKeys[0] ?? null,
        focusKey,
        keys: new Set(targetKeys),
      });
      return focusKey;
    }
    return null;
  };

  const edit = useOutlineEdit({
    containerRef,
    editing,
    onCursorChange: selectOnly,
    onMove: onMove === undefined ? undefined : applyMove,
    rows,
    scrollToIndex: (index) => {
      const row = rows[index];
      virtualizer.scrollToIndex(row === undefined ? index : (visualIndexByKey.get(row.key) ?? index));
    },
  });

  const { consumeDragClick, drag, handlePointerDown } = useOutlineDrag({
    containerRef,
    enabled: onMove !== undefined,
    onCommit: (move) => {
      edit.commitAndExit();
      applyMove(move);
    },
    onExpandedChange,
    rows,
    selectedKeys: activeSelection.keys,
  });
  const draggedRows =
    drag === null
      ? []
      : drag.sourceKeys
          .map((sourceKey) => rows.find((row) => row.key === sourceKey))
          .filter((row): row is OutlineRow<Value> => row !== undefined);

  const selectionRoots = selectedOutlineRoots(rows, activeSelection.keys);

  const performSelectionMove = (operation: "indent" | "outdent" | "reorder-down" | "reorder-up") => {
    if (onMove === undefined || selectionRoots.length === 0) {
      return;
    }
    const move =
      operation === "indent"
        ? computeIndent(rows, selectionRoots)
        : operation === "outdent"
          ? computeOutdent(rows, selectionRoots)
          : computeReorder(rows, selectionRoots, operation === "reorder-up" ? -1 : 1);
    applyMove(move);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const cursor = cursorIndex >= 0 ? rows[cursorIndex] : undefined;
    const structural = onMove !== undefined && (event.ctrlKey || event.metaKey) && event.shiftKey;
    let handled = true;

    if (event.key === "ArrowDown") {
      if (structural && cursor !== undefined) {
        performSelectionMove("reorder-down");
      } else {
        moveCursor(cursorIndex + 1, event.shiftKey);
      }
    } else if (event.key === "ArrowUp") {
      if (structural && cursor !== undefined) {
        performSelectionMove("reorder-up");
      } else {
        moveCursor(Math.max(0, cursorIndex - 1), event.shiftKey);
      }
    } else if (event.key === "ArrowRight" && cursor !== undefined) {
      if (cursor.expandable && !cursor.expanded) {
        requestExpandedChange(cursor.key, true);
      } else if (cursor.hasChildren) {
        moveCursor(cursorIndex + 1);
      }
    } else if (event.key === "ArrowLeft" && cursor !== undefined) {
      if (cursor.expandable && cursor.expanded) {
        requestExpandedChange(cursor.key, false);
      } else if (cursor.parentKey !== null) {
        moveCursor(rows.findIndex((row) => row.key === cursor.parentKey));
      }
    } else if (event.key === "Home") {
      moveCursor(0);
    } else if (event.key === "End") {
      moveCursor(rows.length - 1);
    } else if (event.key === "Enter" && cursor !== undefined) {
      if (activeSelection.keys.size > 1 || editing === undefined || editing.isEditable?.(cursor) === false) {
        onSelect?.(cursor.key);
      } else {
        edit.startAtEnd(cursor);
      }
    } else if (event.key === "Tab" && onMove !== undefined && cursor !== undefined) {
      performSelectionMove(event.shiftKey ? "outdent" : "indent");
    } else if (
      event.key === "Backspace" &&
      event.shiftKey &&
      (event.ctrlKey || event.metaKey) &&
      onDeleteSelection !== undefined &&
      selectionRoots.length > 0
    ) {
      onDeleteSelection(selectionRoots);
      commitSelection(emptyOutlineSelection);
    } else if (event.key === "Escape" && activeSelection.keys.size > 1 && cursorKey !== null) {
      selectOnly(cursorKey);
    } else if (
      editing !== undefined &&
      cursor !== undefined &&
      editing.isEditable?.(cursor) !== false &&
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      edit.startAtEnd(cursor, event.key);
    } else {
      handled = false;
    }

    if (handled) {
      event.preventDefault();
    }
  };

  return (
    <div
      aria-activedescendant={cursorKey === null || edit.activeKey !== null ? undefined : rowDomId(cursorKey)}
      aria-label={label}
      aria-multiselectable="true"
      className="relative w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      onFocus={() => {
        if (cursorKey === null && rows.length > 0) {
          const firstKey = rows[0]?.key;
          if (firstKey !== undefined) {
            selectOnly(firstKey);
          }
        }
      }}
      onKeyDown={handleKeyDown}
      ref={containerRef}
      role="tree"
      style={{ height: virtualizer.getTotalSize() }}
      tabIndex={0}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const visualRow = visualRows[item.index];
        if (visualRow === undefined) {
          return null;
        }
        const entries = visualRow.kind === "nodes" ? visualRow.visualRow.entries : [];
        const placeholderLayout = visualRow.kind === "empty-child" ? visualRow.layout : undefined;
        const usesColumns =
          placeholderLayout?.column !== undefined || entries.some((entry) => entry.layout.column !== undefined);
        const beginsInTrailingColumn =
          placeholderLayout?.column === "trailing" || entries[0]?.layout.column === "trailing";
        return (
          <div
            className="absolute inset-x-0 top-0 grid min-h-8 items-start has-[[role=listbox]]:z-30"
            data-index={item.index}
            data-ui="outline-visual-row"
            key={visualRow.key}
            ref={virtualizer.measureElement}
            style={{
              gridTemplateColumns: usesColumns ? "min(16rem, 42%) minmax(0, 1fr)" : "minmax(0, 1fr)",
              transform: `translateY(${String(item.start - virtualizer.options.scrollMargin)}px)`,
            }}
          >
            {beginsInTrailingColumn ? <span aria-hidden /> : null}
            {visualRow.kind === "empty-child" ? (
              <OutlineEmptyChild
                column={visualRow.layout.column}
                indentDepth={visualRow.layout.indentDepth ?? visualRow.parent.depth + 1}
                onActivate={() => edit.createChild(visualRow.parent)}
                parentKey={visualRow.parent.key}
                parentNodeId={visualRow.parent.occurrence.nodeId}
                showGuides={showGuides}
              />
            ) : (
              visualRow.visualRow.entries.map(({ index, layout, row }) => {
                const selected = activeSelection.keys.has(row.key);
                return (
                  <OutlineTreeRow
                    consumeDragClick={consumeDragClick}
                    cursor={row.key === cursorKey}
                    draggable={onMove !== undefined}
                    dragged={drag?.sourceKeys.includes(row.key) === true}
                    editActiveKey={edit.activeKey}
                    editBinding={edit.binding}
                    editing={editing}
                    indentDepth={layout.indentDepth ?? row.depth}
                    key={row.key}
                    layout={layout}
                    logicalIndex={index}
                    onCommitAndExit={edit.commitAndExit}
                    onExpandedChange={requestExpandedChange}
                    onPointerDown={(event) => {
                      edit.commitAndExit();
                      handlePointerDown(row.key)(event);
                    }}
                    onRowClick={(event) => {
                      if (event.shiftKey) {
                        commitSelection(extendOutlineSelection(rows, activeSelection, row.key));
                      } else if (event.ctrlKey || event.metaKey) {
                        commitSelection(toggleOutlineRow(activeSelection, row.key));
                      } else {
                        selectOnly(row.key);
                      }
                    }}
                    onTextClick={(event) => {
                      event.stopPropagation();
                      if (event.shiftKey) {
                        commitSelection(extendOutlineSelection(rows, activeSelection, row.key));
                        containerRef.current?.focus();
                        return;
                      }
                      if (event.ctrlKey || event.metaKey) {
                        commitSelection(toggleOutlineRow(activeSelection, row.key));
                        containerRef.current?.focus();
                        return;
                      }
                      selectOnly(row.key);
                      if (editing?.isEditable?.(row) === false) {
                        return;
                      }
                      const content = event.currentTarget.querySelector<HTMLElement>(
                        '[data-ui="outline-inline-content"]',
                      );
                      if (content === null) {
                        edit.startAtEnd(row);
                      } else {
                        edit.startAtCaret(row, caretOffsetAtPoint(content, event.clientX, event.clientY));
                      }
                    }}
                    onBulletClick={onBulletClick}
                    renderBullet={renderBullet}
                    renderRow={renderRow}
                    row={row}
                    rowDomId={rowDomId(row.key)}
                    selected={selected}
                    selectionSize={activeSelection.keys.size}
                    showGuides={showGuides}
                  />
                );
              })
            )}
          </div>
        );
      })}
      {activeSelection.keys.size > 1 ? (
        <OutlineSelectionToolbar
          count={activeSelection.keys.size}
          onDelete={
            onDeleteSelection === undefined
              ? undefined
              : () => {
                  onDeleteSelection(selectionRoots);
                  commitSelection(emptyOutlineSelection);
                }
          }
          onMove={onMove === undefined ? undefined : performSelectionMove}
        />
      ) : null}
      {drag?.target == null ? null : (
        <div
          className="pointer-events-none absolute right-2 z-10 flex items-center"
          style={{ left: drag.target.depth * OUTLINE_INDENT + 6, top: drag.target.y - 4 }}
        >
          <span className="size-2 rounded-full border-2 border-primary" />
          <span className="h-0.5 min-w-0 flex-1 rounded-full bg-primary" />
        </div>
      )}
      {drag === null || draggedRows[0] === undefined ? null : (
        <div
          className="pointer-events-none fixed z-50 max-w-72 rounded-md border border-border bg-popover px-3 py-1.5 text-body text-popover-foreground shadow-lg"
          style={{ left: drag.pointer.x + 14, top: drag.pointer.y + 12 }}
        >
          {renderRow(draggedRows[0])}
          {draggedRows.length <= 1 ? null : (
            <span className="ml-2 text-caption text-muted-foreground">+{String(draggedRows.length - 1)}</span>
          )}
        </div>
      )}
    </div>
  );
}
