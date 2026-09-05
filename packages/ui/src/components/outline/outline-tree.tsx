import { useId, useMemo, useRef } from "react";

import { useOutlineInteraction } from "./outline-interaction.js";
import type { OutlineHostCommand } from "./outline-commands.js";
export type { OutlineHostCommand, OutlineCommandContext, OutlineCommandKeyBinding } from "./outline-commands.js";
import { OutlineEmptyChild } from "./outline-empty-child.js";
import { useOutlineDrag } from "./outline-tree-drag.js";
import type {
  OutlineCompletionContext,
  OutlineCompletionItem,
  OutlineCompletionMatch,
  OutlineCompletionProvider,
  OutlineTreeEditing,
  OutlineClipboardItem,
  OutlinePaste,
  OutlineEditHistory,
} from "./outline-tree-edit-contract.js";
import { OutlineInlineContent } from "./outline-tree-editor.js";
import { OutlineInlineExtensionsProvider } from "./outline-source-content.js";
import type { OutlineInlineExtension } from "./outline-inline-extension.js";
import { OutlineSelectionToolbar } from "./outline-tree-controls.js";
import { OutlineChildren, OutlineNodeEnvironmentProvider, type OutlineNodeEnvironment } from "./outline-tree-node.js";
import { OutlineItemContent } from "./outline-tree-row.js";
import { resolveOutlinePresentation, type OutlinePresentationRegistry } from "./outline-presentation.js";
import {
  flattenOutline,
  type OutlineItemViewModel,
  type OutlineMerge,
  type OutlineMove,
  type OutlineMoveResult,
  type OutlineEditPosition,
  type OutlineRowViewModel,
} from "./outline-tree-view-model.js";
import { outlineSelectionCoverage, selectedOutlineRoots, type OutlineSelection } from "./outline-selection.js";

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
  OutlineMoveResult,
  OutlineRowViewModel,
  OutlineSelection,
  OutlineTreeEditing,
  OutlineClipboardItem,
  OutlinePaste,
  OutlineEditHistory,
  OutlineEditPosition,
};

type OutlineTreeProperties<Presentation, Action> = Readonly<{
  commands?: readonly OutlineHostCommand[];
  inlineExtensions?: readonly OutlineInlineExtension[];
  editing?: OutlineTreeEditing;
  expandedKeys: ReadonlySet<string>;
  items: readonly OutlineItemViewModel<Presentation>[];
  label: string;
  onExpandedChange: (key: string, expanded: boolean) => void;
  /** Structure edits return the host's appearance mapping for focus and selection continuity. */
  onMove?: (move: OutlineMove) => OutlineMoveResult | null;
  onDeleteSelection?: (keys: readonly string[]) => void;
  onPresentationAction?: (key: string, action: Action) => void;
  onSelectionChange?: (selection: OutlineSelection) => void;
  selection?: OutlineSelection;
  showGuides?: boolean;
  presentation: OutlinePresentationRegistry<Presentation, Action>;
}>;

export function OutlineTree<Presentation, Action>({
  commands,
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
  const presentRow = (row: OutlineRowViewModel, selected: boolean) =>
    resolveOutlinePresentation(
      presentation,
      row.item.presentation as Presentation,
      row.key,
      row.item.accessibilityLabel,
      { depth: row.depth, expanded: row.expanded, expandable: row.expandable, hasChildren: row.hasChildren, selected },
      onPresentationAction,
      {
        executeCommand: (id) => interaction.executeCommand(id, "presentation", [row.key]),
        canExecuteCommand: (id) => interaction.canExecuteCommand(id, [row.key]),
      },
    );
  const rowDomId = (key: string) => `${treeId}-${encodeURIComponent(key)}`;
  const interaction = useOutlineInteraction({
    commands,
    containerRef,
    rows,
    editing,
    selection,
    onSelectionChange,
    onMove,
    onDeleteSelection,
    onExpandedChange,
    scrollToKey: (key) => document.getElementById(rowDomId(key))?.scrollIntoView({ block: "nearest" }),
    onActivate: (row) => presentRow(row, false).bullet.onActivate?.(),
  });
  const { edit, cursorKey, selection: nodeSelection } = interaction;
  const coverage = useMemo(() => outlineSelectionCoverage(rows, nodeSelection.keys), [rows, nodeSelection.keys]);
  const selectedKeys = useMemo(() => new Set(coverage.keys()), [coverage]);
  const selectionRoots = useMemo(() => selectedOutlineRoots(rows, nodeSelection.keys), [rows, nodeSelection.keys]);
  const { consumeDragClick, drag, handlePointerDown } = useOutlineDrag({
    containerRef,
    enabled: onMove !== undefined,
    onCommit: interaction.moveTo,
    onExpandedChange,
    rows,
    selectedKeys,
  });
  const draggedRows =
    drag === null
      ? []
      : drag.sourceKeys
          .map((key) => rowsByKey.get(key))
          .filter((row): row is OutlineRowViewModel<Presentation> => row !== undefined);
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
    onExpandedChange: interaction.expand,
    onPointerDown: handlePointerDown,
    onRowMouseDown: (row) => (event) => interaction.mouseDown(row, event),
    present: presentRow,
    rowDomId,
    rowsByKey,
    selectedKeys,
    selectionRootKeys: new Set(selectionRoots),
    showGuides,
    supportsEmptyChildren: editing?.onCreateChild !== undefined,
  };
  return (
    <div
      aria-activedescendant={cursorKey === null || edit.activeKey !== null ? undefined : rowDomId(cursorKey)}
      aria-label={label}
      aria-multiselectable="true"
      className="relative w-full rounded-sm outline-none"
      onKeyDown={interaction.handleKeyDown}
      {...interaction.clipboard}
      ref={containerRef}
      role="tree"
      tabIndex={0}
    >
      <OutlineInlineExtensionsProvider value={inlineExtensions}>
        <OutlineNodeEnvironmentProvider value={environment}>
          <OutlineChildren items={items} parent={null} />
          {items.length === 0 && editing?.onCreateRoot !== undefined ? (
            <OutlineEmptyChild parentKey={null} parentLabel={label} onActivate={() => interaction.createRoot()} />
          ) : null}
        </OutlineNodeEnvironmentProvider>
      </OutlineInlineExtensionsProvider>
      {nodeSelection.keys.size === 0 ? null : (
        <OutlineSelectionToolbar
          count={selectionRoots.length}
          containerRef={containerRef}
          anchorKey={selectionRoots[0] ?? null}
          commands={commands?.filter((command) => command.inSelectionToolbar)}
          canExecuteCommand={(id) => interaction.canExecuteCommand(id, undefined, "toolbar")}
          executeCommand={(id) => interaction.executeCommand(id, "toolbar")}
          onDelete={onDeleteSelection === undefined ? undefined : interaction.deleteSelected}
          onMove={onMove === undefined ? undefined : interaction.moveSelected}
        />
      )}
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
