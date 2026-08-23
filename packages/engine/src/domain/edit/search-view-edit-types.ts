import type {
  FactActionId,
  SearchClause,
  SearchExpressionDraft,
  SequenceAnchor,
  ViewSortDirection,
  ViewType,
} from "../fact/index.js";

export type CreateSearchExpressionEdit = Readonly<{
  kind: "search-expression-create";
  searchNodeId: string;
  expression: SearchExpressionDraft;
  anchor: SequenceAnchor;
}>;

export type AddSearchExpressionEdit = Readonly<{
  kind: "search-expression-add";
  searchNodeId: string;
  parentExpressionId: FactActionId;
  expression: SearchExpressionDraft;
  anchor: SequenceAnchor;
}>;

export type ConfigureSearchExpressionEdit = Readonly<{
  kind: "search-expression-configure";
  searchNodeId: string;
  expressionId: FactActionId;
  clause: SearchClause;
}>;

export type MoveSearchExpressionEdit = Readonly<{
  kind: "search-expression-move";
  searchNodeId: string;
  expressionId: FactActionId;
  parentExpressionId: FactActionId | null;
  anchor: SequenceAnchor;
}>;

export type RemoveSearchExpressionEdit = Readonly<{
  kind: "search-expression-remove";
  searchNodeId: string;
  expressionId: FactActionId;
}>;

export type CreateSharedDefaultViewDefinitionEdit = Readonly<{
  kind: "shared-default-view-create";
  hostNodeId: string;
  viewType: ViewType;
  anchor: SequenceAnchor;
}>;

export type RemoveSharedDefaultViewDefinitionEdit = Readonly<{
  kind: "shared-default-view-remove";
  hostNodeId: string;
}>;

export type ViewModeEdit = Readonly<{
  kind: "view-mode-set";
  hostNodeId: string;
  viewId: FactActionId;
  viewType: ViewType;
}>;

export type ViewColumnEdit =
  | Readonly<{
      kind: "view-column-add";
      hostNodeId: string;
      viewId: FactActionId;
      fieldDefinitionId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{ kind: "view-column-remove"; hostNodeId: string; viewId: FactActionId; fieldDefinitionId: string }>
  | Readonly<{
      kind: "view-column-move";
      hostNodeId: string;
      viewId: FactActionId;
      columnId: FactActionId;
      anchor: SequenceAnchor;
    }>;

export type ViewSortEdit =
  | Readonly<{
      kind: "view-sort-add";
      hostNodeId: string;
      viewId: FactActionId;
      fieldDefinitionId: string;
      direction: ViewSortDirection;
    }>
  | Readonly<{
      kind: "view-sort-configure";
      hostNodeId: string;
      viewId: FactActionId;
      sortId: FactActionId;
      fieldDefinitionId: string;
      direction: ViewSortDirection;
    }>
  | Readonly<{ kind: "view-sort-remove"; hostNodeId: string; viewId: FactActionId }>
  | Readonly<{
      kind: "view-sort-by-node-name";
      hostNodeId: string;
      viewId: FactActionId;
      direction: ViewSortDirection;
    }>;

export type ViewGroupEdit =
  | Readonly<{ kind: "view-group-add"; hostNodeId: string; viewId: FactActionId; fieldDefinitionId: string }>
  | Readonly<{ kind: "view-group-remove"; hostNodeId: string; viewId: FactActionId }>;

export type ViewFilterEdit =
  | Readonly<{
      kind: "view-filter-create";
      hostNodeId: string;
      viewId: FactActionId;
      expression: SearchExpressionDraft;
      anchor: SequenceAnchor;
    }>
  | Readonly<{ kind: "view-filter-remove"; hostNodeId: string; viewId: FactActionId }>
  | Readonly<{
      kind: "view-filter-expression-add";
      hostNodeId: string;
      viewId: FactActionId;
      filterId: FactActionId;
      parentExpressionId: FactActionId;
      expression: SearchExpressionDraft;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "view-filter-expression-configure";
      hostNodeId: string;
      viewId: FactActionId;
      filterId: FactActionId;
      expressionId: FactActionId;
      clause: SearchClause;
    }>
  | Readonly<{
      kind: "view-filter-expression-move";
      hostNodeId: string;
      viewId: FactActionId;
      filterId: FactActionId;
      expressionId: FactActionId;
      parentExpressionId: FactActionId | null;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "view-filter-expression-remove";
      hostNodeId: string;
      viewId: FactActionId;
      filterId: FactActionId;
      expressionId: FactActionId;
    }>;
