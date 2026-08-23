import {
  parseSearchClause,
  parseSearchExpressionDraft,
  parseSequenceAnchor,
  requireFactActionId,
} from "../fact/index.js";
import { exactInputKeys, nonemptyInputString } from "./input-validation-primitives.js";
import type { EditAction } from "./types.js";

export function parseSupertagApplicationCreate(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "hostNodeId", "supertagId", "anchor"]);
  return {
    kind: "supertag-application-create",
    hostNodeId: nonemptyInputString(edit.hostNodeId, "Supertag Application host Node identity"),
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition identity"),
    anchor: parseSequenceAnchor(edit.anchor),
  };
}

export function parseSupertagApplicationRemove(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "hostNodeId", "supertagId"]);
  return {
    kind: "supertag-remove",
    hostNodeId: nonemptyInputString(edit.hostNodeId, "Supertag Application host Node identity"),
    supertagId: nonemptyInputString(edit.supertagId, "Supertag Definition identity"),
  };
}

export function parseViewEdit(edit: Record<string, unknown>): EditAction {
  const hostNodeId = nonemptyInputString(edit.hostNodeId, "View host Node identity");
  if (edit.kind === "shared-default-view-create") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewType", "anchor"]);
    if (edit.viewType !== "outline" && edit.viewType !== "table") {
      throw new Error("View type is invalid");
    }
    return { kind: edit.kind, hostNodeId, viewType: edit.viewType, anchor: parseSequenceAnchor(edit.anchor) };
  }
  if (edit.kind === "shared-default-view-remove") {
    exactInputKeys(edit, ["kind", "hostNodeId"]);
    return { kind: edit.kind, hostNodeId };
  }
  const viewId = requireFactActionId(edit.viewId, "View identity");
  if (edit.kind === "view-mode-set") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "viewType"]);
    if (edit.viewType !== "outline" && edit.viewType !== "table") {
      throw new Error("View type is invalid");
    }
    return { kind: edit.kind, hostNodeId, viewId, viewType: edit.viewType };
  }
  if (edit.kind === "view-column-add") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "fieldDefinitionId", "anchor"]);
    return {
      kind: edit.kind,
      hostNodeId,
      viewId,
      fieldDefinitionId: fieldId(edit),
      anchor: parseSequenceAnchor(edit.anchor),
    };
  }
  if (edit.kind === "view-column-remove") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "fieldDefinitionId"]);
    return { kind: edit.kind, hostNodeId, viewId, fieldDefinitionId: fieldId(edit) };
  }
  if (edit.kind === "view-column-move") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "columnId", "anchor"]);
    return {
      kind: edit.kind,
      hostNodeId,
      viewId,
      columnId: requireFactActionId(edit.columnId, "View Column identity"),
      anchor: parseSequenceAnchor(edit.anchor),
    };
  }
  if (edit.kind === "view-sort-add") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "fieldDefinitionId", "direction"]);
    return {
      kind: edit.kind,
      hostNodeId,
      viewId,
      fieldDefinitionId: fieldId(edit),
      direction: sortDirection(edit.direction),
    };
  }
  if (edit.kind === "view-sort-configure") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "sortId", "fieldDefinitionId", "direction"]);
    return {
      kind: edit.kind,
      hostNodeId,
      viewId,
      sortId: requireFactActionId(edit.sortId, "View Sort identity"),
      fieldDefinitionId: fieldId(edit),
      direction: sortDirection(edit.direction),
    };
  }
  if (edit.kind === "view-sort-remove" || edit.kind === "view-group-remove" || edit.kind === "view-filter-remove") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId"]);
    return { kind: edit.kind, hostNodeId, viewId };
  }
  if (edit.kind === "view-sort-by-node-name") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "direction"]);
    return { kind: edit.kind, hostNodeId, viewId, direction: sortDirection(edit.direction) };
  }
  if (edit.kind === "view-group-add") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "fieldDefinitionId"]);
    return { kind: edit.kind, hostNodeId, viewId, fieldDefinitionId: fieldId(edit) };
  }
  if (
    edit.kind === "view-filter-expression-add" ||
    edit.kind === "view-filter-expression-configure" ||
    edit.kind === "view-filter-expression-move" ||
    edit.kind === "view-filter-expression-remove"
  ) {
    return parseViewFilterExpressionEdit(edit, hostNodeId, viewId);
  }
  exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "expression", "anchor"]);
  return {
    kind: "view-filter-create",
    hostNodeId,
    viewId,
    expression: parseSearchExpressionDraft(edit.expression),
    anchor: parseSequenceAnchor(edit.anchor),
  };
}

function parseViewFilterExpressionEdit(
  edit: Record<string, unknown>,
  hostNodeId: string,
  viewId: ReturnType<typeof requireFactActionId>,
): EditAction {
  const filterId = requireFactActionId(edit.filterId, "View Filter identity");
  if (edit.kind === "view-filter-expression-add") {
    exactInputKeys(edit, ["kind", "hostNodeId", "viewId", "filterId", "parentExpressionId", "expression", "anchor"]);
    return {
      kind: edit.kind,
      hostNodeId,
      viewId,
      filterId,
      parentExpressionId: requireFactActionId(edit.parentExpressionId, "Search parent Expression identity"),
      expression: parseSearchExpressionDraft(edit.expression),
      anchor: parseSequenceAnchor(edit.anchor),
    };
  }
  exactInputKeys(
    edit,
    edit.kind === "view-filter-expression-configure"
      ? ["kind", "hostNodeId", "viewId", "filterId", "expressionId", "clause"]
      : edit.kind === "view-filter-expression-move"
        ? ["kind", "hostNodeId", "viewId", "filterId", "expressionId", "parentExpressionId", "anchor"]
        : ["kind", "hostNodeId", "viewId", "filterId", "expressionId"],
  );
  const expressionId = requireFactActionId(edit.expressionId, "Search Expression identity");
  if (edit.kind === "view-filter-expression-configure") {
    return { kind: edit.kind, hostNodeId, viewId, filterId, expressionId, clause: parseSearchClause(edit.clause) };
  }
  if (edit.kind === "view-filter-expression-move") {
    return {
      kind: edit.kind,
      hostNodeId,
      viewId,
      filterId,
      expressionId,
      parentExpressionId:
        edit.parentExpressionId === null
          ? null
          : requireFactActionId(edit.parentExpressionId, "Search parent Expression identity"),
      anchor: parseSequenceAnchor(edit.anchor),
    };
  }
  return { kind: "view-filter-expression-remove", hostNodeId, viewId, filterId, expressionId };
}

function fieldId(edit: Record<string, unknown>): string {
  return nonemptyInputString(edit.fieldDefinitionId, "View option Field Definition identity");
}

function sortDirection(value: unknown): "ascending" | "descending" {
  if (value !== "ascending" && value !== "descending") {
    throw new Error("View Sort direction is invalid");
  }
  return value;
}

export function parseSearchExpressionCreate(edit: Record<string, unknown>): EditAction {
  exactInputKeys(edit, ["kind", "searchNodeId", "expression", "anchor"]);
  return {
    kind: "search-expression-create",
    searchNodeId: nonemptyInputString(edit.searchNodeId, "Search Node identity"),
    expression: parseSearchExpressionDraft(edit.expression),
    anchor: parseSequenceAnchor(edit.anchor),
  };
}

export function parseSearchExpressionEdit(edit: Record<string, unknown>): EditAction {
  const searchNodeId = nonemptyInputString(edit.searchNodeId, "Search Node identity");
  if (edit.kind === "search-expression-add") {
    exactInputKeys(edit, ["kind", "searchNodeId", "parentExpressionId", "expression", "anchor"]);
    return {
      kind: edit.kind,
      searchNodeId,
      parentExpressionId: requireFactActionId(edit.parentExpressionId, "Search parent Expression identity"),
      expression: parseSearchExpressionDraft(edit.expression),
      anchor: parseSequenceAnchor(edit.anchor),
    };
  }
  exactInputKeys(
    edit,
    edit.kind === "search-expression-configure"
      ? ["kind", "searchNodeId", "expressionId", "clause"]
      : edit.kind === "search-expression-move"
        ? ["kind", "searchNodeId", "expressionId", "parentExpressionId", "anchor"]
        : ["kind", "searchNodeId", "expressionId"],
  );
  const expressionId = requireFactActionId(edit.expressionId, "Search Expression identity");
  if (edit.kind === "search-expression-configure") {
    return { kind: edit.kind, searchNodeId, expressionId, clause: parseSearchClause(edit.clause) };
  }
  if (edit.kind === "search-expression-move") {
    return {
      kind: edit.kind,
      searchNodeId,
      expressionId,
      parentExpressionId:
        edit.parentExpressionId === null
          ? null
          : requireFactActionId(edit.parentExpressionId, "Search parent Expression identity"),
      anchor: parseSequenceAnchor(edit.anchor),
    };
  }
  return { kind: "search-expression-remove", searchNodeId, expressionId };
}
