import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { caretOffsetAtPoint } from "./outline-caret.js";
import { useOutlineDrag } from "./outline-tree-drag.js";
import {
  useOutlineEdit,
  type OutlineCompletionContext,
  type OutlineCompletionItem,
  type OutlineCompletionMatch,
  type OutlineCompletionProvider,
  type OutlineTreeEditing,
} from "./outline-tree-edit.js";
import { OutlineInlineContent } from "./outline-tree-editor.js";
import { OutlineInlineExtensionsProvider } from "./outline-source-content.js";
import type { OutlineInlineExtension } from "./outline-inline-extension.js";
import { OutlineSelectionToolbar } from "./outline-tree-controls.js";
import { OutlineChildren, OutlineNodeEnvironmentProvider, type OutlineNodeEnvironment } from "./outline-tree-node.js";
import { OutlineItemContent } from "./outline-tree-row.js";
import { resolveOutlinePresentation, type OutlinePresentationRegistry } from "./outline-presentation.js";
import {
  computeIndent,
  computeOutdent,
  computeReorder,
  flattenOutline,
  type OutlineItemViewModel,
  type OutlineMerge,
  type OutlineMove,
  type OutlineRowViewModel,
} from "./outline-tree-view-model.js";
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
export { OutlineBullet, OutlineBulletDot } from "./outline-bullet.js";
export { OutlineRowProgress } from "./outline-row.js";
export type { OutlineContent, OutlineInline, OutlineToken } from "./outline-content.js";
export type { OutlineInlineExtension, OutlineSourceEdit, OutlineSyntaxMatch } from "./outline-inline-extension.js";
export { outlineFormatting } from "./outline-formatting.js";
export type {
  OutlineBulletPresentation,
  OutlineChildrenLayout,
  OutlineContentStyle,
  OutlinePresentationContext,
  OutlinePresentationRegistry,
  OutlinePresentationRowState,
  OutlineRowPresentation,
} from "./outline-presentation.js";
export type {
  OutlineCompletionContext,
  OutlineCompletionItem,
  OutlineCompletionMatch,
  OutlineCompletionProvider,
  OutlineItemViewModel,
  OutlineMerge,
  OutlineMove,
  OutlineRowViewModel,
  OutlineSelection,
  OutlineTreeEditing,
};

type OutlineTreeProperties<Presentation, Action> = Readonly<{
  inlineExtensions?: readonly OutlineInlineExtension[];
  editing?: OutlineTreeEditing;
  expandedKeys: ReadonlySet<string>;
  items: readonly OutlineItemViewModel<Presentation>[];
  label: string;
  onExpandedChange: (key: string, expanded: boolean) => void;
  /** Structure edits: Tab/Shift+Tab indents and Ctrl/Cmd+Shift+Arrow reorders the selection atomically. */
  onMove?: (move: OutlineMove) => void;
  onDeleteSelection?: (keys: readonly string[]) => void;
  onPresentationAction?: (key: string, action: Action) => void;
  onSelectionChange?: (selection: OutlineSelection) => void;
  selection?: OutlineSelection;
  showGuides?: boolean;
  presentation: OutlinePresentationRegistry<Presentation, Action>;
}>;

export function OutlineTree<Presentation, Action>({
  inlineExtensions = [],
  editing,
  expandedKeys,
  items,
  label,
  onDeleteSelection,
  onExpandedChange,
  onMove,
  onPresentationAction,
  onSelectionChange,
  presentation,
  selection,
  showGuides = false,
}: OutlineTreeProperties<Presentation, Action>) {
  const treeId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => flattenOutline(items, expandedKeys), [expandedKeys, items]);
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const [internalSelection, setInternalSelection] = useState<OutlineSelection>(emptyOutlineSelection);
  const activeSelection = useMemo(
    () => normalizeOutlineSelection(rows, selection ?? internalSelection),
    [internalSelection, rows, selection],
  );
  const cursorKey = activeSelection.focusKey;
  const cursorIndex = cursorKey === null ? -1 : rows.findIndex((row) => row.key === cursorKey);
  const presentRow = (row: OutlineRowViewModel, selected: boolean) =>
    resolveOutlinePresentation(
      presentation,
      row.item.presentation as Presentation,
      row.key,
      row.item.accessibilityLabel,
      {
        depth: row.depth,
        expanded: row.expanded,
        expandable: row.expandable,
        hasChildren: row.hasChildren,
        selected,
      },
      onPresentationAction,
    );

  const rowDomId = (key: string) => `${treeId}-${encodeURIComponent(key)}`;
  const scrollToKey = (key: string) => {
    document.getElementById(rowDomId(key))?.scrollIntoView({ block: "nearest" });
  };

  const commitSelection = (next: OutlineSelection) => {
    if (selection === undefined) {
      setInternalSelection(next);
    }
    onSelectionChange?.(next);
  };

  const selectOnly = (key: string) => commitSelection(selectOutlineRow(key));

  const moveCursor = (index: number, extend = false) => {
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    commitSelection(extend ? extendOutlineSelection(rows, activeSelection, row.key) : selectOutlineRow(row.key));
    scrollToKey(row.key);
  };

  const applyMove = (move: OutlineMove | null) => {
    if (move === null || onMove === undefined) {
      return;
    }
    // The destination must be visible, or the row would vanish on landing.
    if (move.targetParentKey !== null && !expandedKeys.has(move.targetParentKey)) {
      onExpandedChange(move.targetParentKey, true);
    }
    onMove(move);
  };

  const edit = useOutlineEdit({
    containerRef,
    editing,
    onCursorChange: selectOnly,
    onMove: onMove === undefined ? undefined : applyMove,
    rows,
    scrollToKey,
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
          .map((sourceKey) => rowsByKey.get(sourceKey))
          .filter((row): row is OutlineRowViewModel<Presentation> => row !== undefined);

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
        onExpandedChange(cursor.key, true);
      } else if (cursor.hasChildren) {
        moveCursor(cursorIndex + 1);
      }
    } else if (event.key === "ArrowLeft" && cursor !== undefined) {
      if (cursor.expandable && cursor.expanded) {
        onExpandedChange(cursor.key, false);
      } else if (cursor.parentKey !== null) {
        moveCursor(rows.findIndex((row) => row.key === cursor.parentKey));
      }
    } else if (event.key === "Home") {
      moveCursor(0);
    } else if (event.key === "End") {
      moveCursor(rows.length - 1);
    } else if (event.key === "Enter" && cursor !== undefined) {
      if (activeSelection.keys.size > 1 || editing === undefined || cursor.item.editable === false) {
        presentRow(cursor, activeSelection.keys.has(cursor.key)).bullet.onActivate?.();
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
      cursor.item.editable !== false &&
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

  const selectRow = (row: OutlineRowViewModel, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (event.shiftKey) {
      commitSelection(extendOutlineSelection(rows, activeSelection, row.key));
    } else if (event.ctrlKey || event.metaKey) {
      commitSelection(toggleOutlineRow(activeSelection, row.key));
    } else {
      selectOnly(row.key);
    }
  };

  const environment: OutlineNodeEnvironment = {
    consumeDragClick,
    createChild: edit.createChild,
    draggable: onMove !== undefined,
    draggedKeys: drag?.sourceKeys ?? [],
    dropTarget: drag?.target ?? null,
    editActiveKey: edit.activeKey,
    editBinding: edit.binding,
    editing,
    focusKey: cursorKey,
    onCommitAndExit: edit.commitAndExit,
    onExpandedChange,
    onPointerDown: (key) => (event) => {
      edit.commitAndExit();
      handlePointerDown(key)(event);
    },
    onRowClick: (row) => (event) => selectRow(row, event),
    onTextClick: (row) => (event) => {
      event.stopPropagation();
      const modified = event.shiftKey || event.ctrlKey || event.metaKey;
      selectRow(row, event);
      if (modified) {
        containerRef.current?.focus();
        return;
      }
      if (row.item.editable === false) {
        containerRef.current?.focus({ preventScroll: true });
        return;
      }
      const content = event.currentTarget.querySelector<HTMLElement>('[data-ui="outline-inline-content"]');
      if (content === null) {
        edit.startAtEnd(row);
      } else {
        edit.startAtCaret(row, caretOffsetAtPoint(content, event.clientX, event.clientY));
      }
    },
    present: presentRow,
    rowDomId,
    rowsByKey,
    selectedKeys: activeSelection.keys,
    showGuides,
    supportsEmptyChildren: editing?.onCreateChild !== undefined,
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
      tabIndex={0}
    >
      <OutlineInlineExtensionsProvider value={inlineExtensions}>
        <OutlineNodeEnvironmentProvider value={environment}>
          <OutlineChildren items={items} parent={null} />
        </OutlineNodeEnvironmentProvider>
      </OutlineInlineExtensionsProvider>
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
      {drag === null || draggedRows[0] === undefined ? null : (
        <div
          className="pointer-events-none fixed z-50 max-w-72 rounded-md border border-border bg-popover px-3 py-1.5 text-body text-popover-foreground shadow-lg"
          style={{ left: drag.pointer.x + 14, top: drag.pointer.y + 12 }}
        >
          <OutlineInlineExtensionsProvider value={inlineExtensions}>
            <OutlineItemContent presentation={presentRow(draggedRows[0], false)} row={draggedRows[0]} />
          </OutlineInlineExtensionsProvider>
          {draggedRows.length <= 1 ? null : (
            <span className="ml-2 text-caption text-muted-foreground">+{String(draggedRows.length - 1)}</span>
          )}
        </div>
      )}
    </div>
  );
}
