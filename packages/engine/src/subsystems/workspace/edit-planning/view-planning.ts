import type { EditAction } from "../../../domain/edit/index.js";
import { VIEW_SORT_NODE_NAME_NODE_ID, type AuthoredAction, type FactActionId } from "../../../domain/fact/index.js";
import type { ScopedProjection, SharedDefaultViewDefinition } from "../../../domain/reconcile/index.js";
import { sortViewChildrenByNodeName, supportsSharedDefaultViewHost } from "../../../domain/view/index.js";
import { authoredActionBatch, singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import {
  prepareExpressionAddition,
  prepareExpressionEdit,
  searchExpressionDraftActions,
} from "./search-expression-planning.js";

type ViewEdit = Extract<
  EditAction,
  {
    kind:
      | "shared-default-view-create"
      | "shared-default-view-remove"
      | "view-mode-set"
      | "view-column-add"
      | "view-column-remove"
      | "view-column-move"
      | "view-sort-add"
      | "view-sort-configure"
      | "view-sort-remove"
      | "view-sort-by-node-name"
      | "view-group-add"
      | "view-group-remove"
      | "view-filter-create"
      | "view-filter-remove"
      | "view-filter-expression-add"
      | "view-filter-expression-configure"
      | "view-filter-expression-move"
      | "view-filter-expression-remove";
  }
>;

export function prepareViewEdit(
  edit: ViewEdit,
  available: ScopedProjection,
  actionId: (actionIndex: number) => FactActionId,
): AuthoredActionBatch {
  if (edit.kind === "shared-default-view-create") {
    const host = available.nodes[edit.hostNodeId];
    if (!host || !supportsSharedDefaultViewHost(host.intrinsicNodeType)) {
      throw new Error("View host is not active");
    }
    return singleAuthoredActionBatch({
      kind: "shared-default-view-add",
      hostNodeId: edit.hostNodeId,
      viewType: edit.viewType,
      anchor: edit.anchor,
    });
  }
  if (edit.kind === "shared-default-view-remove") {
    if ((available.sharedDefaultViewDefinitions[edit.hostNodeId] ?? []).length === 0) {
      throw new Error("Shared default View is absent");
    }
    return singleAuthoredActionBatch({ kind: edit.kind, hostNodeId: edit.hostNodeId });
  }
  const view = requireView(edit.hostNodeId, edit.viewId, available);
  if (edit.kind === "view-mode-set") {
    if (view.viewType === edit.viewType) {
      throw new Error("View mode update has no effect");
    }
    return singleAuthoredActionBatch({ kind: edit.kind, viewId: edit.viewId, viewType: edit.viewType });
  }
  if (
    edit.kind === "view-filter-expression-add" ||
    edit.kind === "view-filter-expression-configure" ||
    edit.kind === "view-filter-expression-move" ||
    edit.kind === "view-filter-expression-remove"
  ) {
    const filter = view.options.filter;
    if (filter?.filterId !== edit.filterId) {
      throw new Error("View Filter is absent");
    }
    if (edit.kind === "view-filter-expression-add") {
      return prepareExpressionAddition(
        edit.filterId,
        filter.expression,
        edit.parentExpressionId,
        edit.expression,
        edit.anchor,
        available,
        actionId,
      );
    }
    if (edit.kind === "view-filter-expression-configure") {
      return prepareExpressionEdit(
        filter.expression,
        { kind: "search-expression-configure", expressionId: edit.expressionId, clause: edit.clause },
        available,
      );
    }
    if (edit.kind === "view-filter-expression-move") {
      return prepareExpressionEdit(
        filter.expression,
        {
          kind: "search-expression-move",
          expressionId: edit.expressionId,
          parentExpressionId: edit.parentExpressionId,
          anchor: edit.anchor,
        },
        available,
      );
    }
    return prepareExpressionEdit(
      filter.expression,
      { kind: "search-expression-remove", expressionId: edit.expressionId },
      available,
    );
  }
  return prepareViewOptionEdit(edit, view, available, actionId);
}

type ViewOptionEdit = Exclude<
  ViewEdit,
  {
    kind:
      | "shared-default-view-create"
      | "shared-default-view-remove"
      | "view-mode-set"
      | "view-filter-expression-add"
      | "view-filter-expression-configure"
      | "view-filter-expression-move"
      | "view-filter-expression-remove";
  }
>;

function prepareViewOptionEdit(
  edit: ViewOptionEdit,
  view: SharedDefaultViewDefinition,
  available: ScopedProjection,
  actionId: (actionIndex: number) => FactActionId,
): AuthoredActionBatch {
  if (edit.kind === "view-column-add" || edit.kind === "view-column-remove" || edit.kind === "view-column-move") {
    return prepareViewColumnEdit(edit, view, available);
  }
  if (edit.kind === "view-sort-add") {
    requireFieldDefinition(edit.fieldDefinitionId, available);
    if (view.options.sort) {
      throw new Error("View already has a Sort");
    }
    return singleAuthoredActionBatch({
      kind: edit.kind,
      viewId: edit.viewId,
      fieldDefinitionId: edit.fieldDefinitionId,
      direction: edit.direction,
    });
  }
  if (edit.kind === "view-sort-configure") {
    requireFieldDefinition(edit.fieldDefinitionId, available);
    if (view.options.sort?.sortId !== edit.sortId) {
      throw new Error("View Sort is absent");
    }
    return singleAuthoredActionBatch({
      kind: edit.kind,
      sortId: edit.sortId,
      fieldDefinitionId: edit.fieldDefinitionId,
      direction: edit.direction,
    });
  }
  if (edit.kind === "view-sort-remove") {
    if (!view.options.sort) {
      throw new Error("View Sort is absent");
    }
    return singleAuthoredActionBatch({ kind: edit.kind, viewId: edit.viewId });
  }
  if (edit.kind === "view-sort-by-node-name") {
    return nodeNameSort(edit, view, available);
  }
  if (edit.kind === "view-group-add") {
    requireFieldDefinition(edit.fieldDefinitionId, available);
    if (view.options.group) {
      throw new Error("View already has a Group");
    }
    return singleAuthoredActionBatch({
      kind: edit.kind,
      viewId: edit.viewId,
      fieldDefinitionId: edit.fieldDefinitionId,
    });
  }
  if (edit.kind === "view-group-remove") {
    if (!view.options.group) {
      throw new Error("View Group is absent");
    }
    return singleAuthoredActionBatch({ kind: edit.kind, viewId: edit.viewId });
  }
  if (edit.kind === "view-filter-remove") {
    if (!view.options.filter) {
      throw new Error("View Filter is absent");
    }
    return singleAuthoredActionBatch({ kind: edit.kind, viewId: edit.viewId });
  }
  if (view.options.filter) {
    throw new Error("View already has a Filter");
  }
  const filterId = actionId(0);
  const expressions = searchExpressionDraftActions(filterId, edit.expression, edit.anchor, available, actionId, {
    actionOffset: 1,
  });
  return authoredActionBatch([{ kind: "view-filter-add", viewId: edit.viewId }, ...expressions]);
}

function prepareViewColumnEdit(
  edit: Extract<ViewOptionEdit, { kind: "view-column-add" | "view-column-remove" | "view-column-move" }>,
  view: SharedDefaultViewDefinition,
  available: ScopedProjection,
): AuthoredActionBatch {
  if (edit.kind === "view-column-add") {
    requireFieldDefinition(edit.fieldDefinitionId, available);
    if (view.options.columns.some((column) => column.fieldDefinitionId === edit.fieldDefinitionId)) {
      throw new Error("View already has this Column");
    }
    return singleAuthoredActionBatch({
      kind: edit.kind,
      viewId: edit.viewId,
      fieldDefinitionId: edit.fieldDefinitionId,
      anchor: edit.anchor,
    });
  }
  if (edit.kind === "view-column-remove") {
    if (!view.options.columns.some((column) => column.fieldDefinitionId === edit.fieldDefinitionId)) {
      throw new Error("View Column is absent");
    }
    return singleAuthoredActionBatch({
      kind: edit.kind,
      viewId: edit.viewId,
      fieldDefinitionId: edit.fieldDefinitionId,
    });
  }
  if (!view.options.columns.some((column) => column.columnId === edit.columnId)) {
    throw new Error("View Column is absent");
  }
  return singleAuthoredActionBatch({ kind: edit.kind, columnId: edit.columnId, anchor: edit.anchor });
}

function nodeNameSort(
  edit: Extract<EditAction, { kind: "view-sort-by-node-name" }>,
  view: SharedDefaultViewDefinition,
  available: ScopedProjection,
): AuthoredActionBatch {
  const sort: AuthoredAction = view.options.sort
    ? {
        kind: "view-sort-configure",
        sortId: view.options.sort.sortId,
        fieldDefinitionId: VIEW_SORT_NODE_NAME_NODE_ID,
        direction: edit.direction,
      }
    : {
        kind: "view-sort-add",
        viewId: edit.viewId,
        fieldDefinitionId: VIEW_SORT_NODE_NAME_NODE_ID,
        direction: edit.direction,
      };
  const source = (available.childOccurrences[edit.hostNodeId] ?? []).flatMap((occurrenceId) => {
    const occurrence = available.occurrences[occurrenceId];
    return occurrence
      ? [{ sourceKind: "occurrence" as const, sourceIdentity: occurrenceId, targetNodeId: occurrence.nodeId }]
      : [];
  });
  const ascending = sortViewChildrenByNodeName(source, available);
  const ordered = edit.direction === "descending" ? [...ascending].reverse() : ascending;
  const moves = ordered.map((child, index): AuthoredAction => ({
    kind: "placement-move",
    placementId: child.sourceIdentity,
    parentNodeId: edit.hostNodeId,
    anchor:
      index === 0
        ? { after: null, before: null, affinity: "before", fallback: "start" }
        : { after: ordered[index - 1]?.sourceIdentity ?? null, before: null, affinity: "after", fallback: "end" },
  }));
  return authoredActionBatch([sort, ...moves]);
}

function requireView(
  hostNodeId: string,
  viewId: FactActionId,
  available: ScopedProjection,
): SharedDefaultViewDefinition {
  const view = (available.sharedDefaultViewDefinitions[hostNodeId] ?? []).find(
    (candidate) => candidate.viewId === viewId,
  );
  if (!view) {
    throw new Error("Shared default View is absent");
  }
  if (view.optionsConflicted) {
    throw new Error("View conflict must be resolved before editing");
  }
  return view;
}

function requireFieldDefinition(fieldDefinitionId: string, available: ScopedProjection): void {
  if (available.nodes[fieldDefinitionId]?.intrinsicNodeType !== "field-definition") {
    throw new Error("View option Field Definition is not active");
  }
}
