import { createContext, Fragment, useContext, type MouseEvent, type PointerEvent } from "react";

import { cn } from "../cn.js";
import { OutlineEmptyChild } from "./outline-empty-child.js";
import type { ResolvedOutlineRowPresentation } from "./outline-presentation.js";
import type { OutlineEditorBinding, OutlineTreeEditing } from "./outline-tree-edit-contract.js";
import { OutlineTreeRow } from "./outline-tree-row.js";
import type { OutlineItemViewModel, OutlineMove, OutlineRowViewModel } from "./outline-tree-view-model.js";

const OUTLINE_COLUMN_TEMPLATE = "min(16rem, 42%) minmax(0, 1fr)";

/** Per-tree state and intents shared by every node; nodes only add their own row identity. */
export type OutlineNodeEnvironment = Readonly<{
  consumeDragClick: () => boolean;
  createChild: (parent: OutlineRowViewModel) => void;
  draggable: boolean;
  draggedKeys: readonly string[];
  dropTarget: OutlineMove | null;
  editActiveKey: string | null;
  editBinding: OutlineEditorBinding | null;
  editing?: OutlineTreeEditing;
  focusKey: string | null;
  onCommitAndExit: () => void;
  onExpandedChange: (key: string, expanded: boolean) => void;
  onPointerDown: (key: string) => (event: PointerEvent) => void;
  onRowClick: (row: OutlineRowViewModel) => (event: MouseEvent) => void;
  onTextClick: (row: OutlineRowViewModel) => (event: MouseEvent<HTMLDivElement>) => void;
  rowDomId: (key: string) => string;
  present: (row: OutlineRowViewModel, selected: boolean) => ResolvedOutlineRowPresentation;
  rowsByKey: ReadonlyMap<string, OutlineRowViewModel>;
  selectedKeys: ReadonlySet<string>;
  showGuides: boolean;
  supportsEmptyChildren: boolean;
}>;

const OutlineNodeContext = createContext<OutlineNodeEnvironment | null>(null);

export const OutlineNodeEnvironmentProvider = OutlineNodeContext.Provider;

function useOutlineNodeEnvironment(): OutlineNodeEnvironment {
  const environment = useContext(OutlineNodeContext);
  if (environment === null) {
    throw new Error("Outline nodes must render inside OutlineTree");
  }
  return environment;
}

export function OutlineChildren({
  items,
  parent,
  parentPresentation,
}: Readonly<{
  items: readonly OutlineItemViewModel[];
  parent: OutlineRowViewModel | null;
  parentPresentation?: ResolvedOutlineRowPresentation;
}>) {
  const environment = useOutlineNodeEnvironment();
  const parentKey = parent?.key ?? null;
  const beside = parentPresentation?.childrenLayout === "beside";
  const visible = parent === null || parent.expanded ? items : [];
  const dropIndex =
    environment.dropTarget?.targetParentKey === parentKey
      ? Math.min(environment.dropTarget.index, visible.length)
      : null;
  const placeholder =
    parent !== null && environment.supportsEmptyChildren && !parent.hasChildren && (parent.expanded || beside);
  if (visible.length === 0 && dropIndex === null && !placeholder) {
    return null;
  }
  return (
    <div
      className={cn("min-w-0", parent !== null && !beside && "relative pl-5")}
      data-parent-key={parentKey ?? undefined}
      data-ui="outline-children"
      role={parent === null ? undefined : "group"}
    >
      {environment.showGuides && parent !== null && !beside ? (
        <span aria-hidden className="absolute inset-y-0 left-2.5 w-px bg-border/45" />
      ) : null}
      {visible.map((item, index) => (
        <Fragment key={item.key}>
          {dropIndex === index ? <OutlineDropIndicator /> : null}
          <OutlineNode item={item} />
        </Fragment>
      ))}
      {dropIndex === visible.length ? <OutlineDropIndicator /> : null}
      {placeholder ? (
        <OutlineEmptyChild
          onActivate={() => environment.createChild(parent)}
          parentKey={parent.key}
          parentLabel={parent.item.accessibilityLabel}
        />
      ) : null}
    </div>
  );
}

function OutlineNode({ item }: Readonly<{ item: OutlineItemViewModel }>) {
  const environment = useOutlineNodeEnvironment();
  const row = environment.rowsByKey.get(item.key);
  if (row === undefined) {
    return null;
  }
  const selected = environment.selectedKeys.has(row.key);
  const presentation = environment.present(row, selected);
  const beside = presentation.childrenLayout === "beside";
  return (
    <div
      className={cn("min-w-0", beside && "grid items-start")}
      data-children-layout={beside ? "beside" : "indented"}
      data-ui="outline-node"
      style={beside ? { gridTemplateColumns: OUTLINE_COLUMN_TEMPLATE } : undefined}
    >
      <OutlineTreeRow
        consumeDragClick={environment.consumeDragClick}
        cursor={row.key === environment.focusKey}
        draggable={environment.draggable}
        dragged={environment.draggedKeys.includes(row.key)}
        editActiveKey={environment.editActiveKey}
        editBinding={environment.editBinding}
        editing={environment.editing}
        onCommitAndExit={environment.onCommitAndExit}
        onExpandedChange={environment.onExpandedChange}
        onPointerDown={environment.onPointerDown(row.key)}
        onRowClick={environment.onRowClick(row)}
        onTextClick={environment.onTextClick(row)}
        row={row}
        rowDomId={environment.rowDomId(row.key)}
        presentation={presentation}
        selected={selected}
        selectionSize={environment.selectedKeys.size}
      />
      <OutlineChildren items={item.children ?? []} parent={row} parentPresentation={presentation} />
    </div>
  );
}

// Zero-height in flow so the line sits exactly in the gap without shifting rows while dragging.
function OutlineDropIndicator() {
  return (
    <div aria-hidden className="pointer-events-none relative z-10 h-0" data-ui="outline-drop-indicator">
      <div className="absolute inset-x-0 -top-1 flex items-center pr-2 pl-1.5">
        <span className="size-2 rounded-full border-2 border-primary" />
        <span className="h-0.5 min-w-0 flex-1 rounded-full bg-primary" />
      </div>
    </div>
  );
}
