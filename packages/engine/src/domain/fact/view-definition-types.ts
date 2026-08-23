import type { FactActionId, SequenceAnchor } from "./types.js";

export type ViewType = "outline" | "table";
export type ViewSortDirection = "ascending" | "descending";

type SharedDefaultViewAddAction = Readonly<{
  kind: "shared-default-view-add";
  hostNodeId: string;
  viewType: ViewType;
  anchor: SequenceAnchor;
}>;

type SharedDefaultViewRemoveAction = Readonly<{
  kind: "shared-default-view-remove";
  hostNodeId: string;
}>;

type SharedDefaultViewRestoreAction = Readonly<{
  kind: "shared-default-view-restore";
  viewId: FactActionId;
}>;

type ViewModeSetAction = Readonly<{
  kind: "view-mode-set";
  viewId: FactActionId;
  viewType: ViewType;
}>;

type ViewColumnAddAction = Readonly<{
  kind: "view-column-add";
  viewId: FactActionId;
  fieldDefinitionId: string;
  anchor: SequenceAnchor;
}>;

type ViewColumnRemoveAction = Readonly<{
  kind: "view-column-remove";
  viewId: FactActionId;
  fieldDefinitionId: string;
}>;

type ViewColumnMoveAction = Readonly<{
  kind: "view-column-move";
  columnId: FactActionId;
  anchor: SequenceAnchor;
}>;

type ViewSortAddAction = Readonly<{
  kind: "view-sort-add";
  viewId: FactActionId;
  fieldDefinitionId: string;
  direction: ViewSortDirection;
}>;

type ViewSortConfigureAction = Readonly<{
  kind: "view-sort-configure";
  sortId: FactActionId;
  fieldDefinitionId: string;
  direction: ViewSortDirection;
}>;

type ViewSortRemoveAction = Readonly<{ kind: "view-sort-remove"; viewId: FactActionId }>;
type ViewSortRestoreAction = Readonly<{ kind: "view-sort-restore"; sortId: FactActionId }>;

type ViewGroupAddAction = Readonly<{
  kind: "view-group-add";
  viewId: FactActionId;
  fieldDefinitionId: string;
}>;

type ViewGroupRemoveAction = Readonly<{ kind: "view-group-remove"; viewId: FactActionId }>;
type ViewFilterAddAction = Readonly<{ kind: "view-filter-add"; viewId: FactActionId }>;
type ViewFilterRemoveAction = Readonly<{ kind: "view-filter-remove"; viewId: FactActionId }>;
type ViewFilterRestoreAction = Readonly<{ kind: "view-filter-restore"; filterId: FactActionId }>;

export type ViewAction =
  | SharedDefaultViewAddAction
  | SharedDefaultViewRemoveAction
  | SharedDefaultViewRestoreAction
  | ViewModeSetAction
  | ViewColumnAddAction
  | ViewColumnRemoveAction
  | ViewColumnMoveAction
  | ViewSortAddAction
  | ViewSortConfigureAction
  | ViewSortRemoveAction
  | ViewSortRestoreAction
  | ViewGroupAddAction
  | ViewGroupRemoveAction
  | ViewFilterAddAction
  | ViewFilterRemoveAction
  | ViewFilterRestoreAction;
