import type { EditAction } from "../../../domain/edit/index.js";
import {
  canonicalJson,
  type FactActionId,
  type SearchClause,
  type SearchExpressionDraft,
  type SearchExpressionSpec,
  type SequenceAnchor,
} from "../../../domain/fact/index.js";
import { searchExpressionProjectionIdentity, type InterpretedProjection } from "../../../domain/reconcile/index.js";
import { authoredActionBatch, singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";

export function prepareSearchExpressionCreation(
  edit: Extract<EditAction, { kind: "search-expression-create" }>,
  available: InterpretedProjection,
  actionId: (actionIndex: number) => FactActionId,
): AuthoredActionBatch {
  if (available.nodes[edit.searchNodeId]?.intrinsicNodeType !== "search") {
    throw new Error("Search Expression host is not an active Search Node");
  }
  if (available.searchExpressions[edit.searchNodeId] !== undefined) {
    throw new Error("Search Node already has a Search Expression");
  }
  const actions = searchExpressionDraftActions(edit.searchNodeId, edit.expression, edit.anchor, available, actionId);
  return authoredActionBatch(actions);
}

export function searchExpressionDraftActions(
  hostId: string,
  draft: SearchExpressionDraft,
  anchor: Extract<EditAction, { kind: "search-expression-create" }>["anchor"],
  available: InterpretedProjection,
  actionId: (actionIndex: number) => FactActionId,
  options: Readonly<{ actionOffset?: number; parentExpressionId?: FactActionId | null }> = {},
): readonly [
  Extract<ReturnType<typeof searchAdd>, { kind: "search-expression-add" }>,
  ...Extract<ReturnType<typeof searchAdd>, { kind: "search-expression-add" }>[],
] {
  const actions: Extract<ReturnType<typeof searchAdd>, { kind: "search-expression-add" }>[] = [];
  const actionOffset = options.actionOffset ?? 0;
  appendDraft(actions, draft, hostId, options.parentExpressionId ?? null, anchor, (index) =>
    actionId(index + actionOffset),
  );
  for (const action of actions) {
    validateSearchClauseTargets(action.clause, available);
  }
  const first = actions[0];
  if (!first) {
    throw new Error("Search Expression draft is empty");
  }
  return [first, ...actions.slice(1)];
}

export function prepareSearchExpressionEdit(
  edit: Extract<
    EditAction,
    {
      kind:
        "search-expression-add" | "search-expression-configure" | "search-expression-move" | "search-expression-remove";
    }
  >,
  available: InterpretedProjection,
  actionId: (actionIndex: number) => FactActionId,
): AuthoredActionBatch {
  const current = available.searchExpressions[edit.searchNodeId];
  if (current === undefined) {
    throw new Error("Search Node has no Search Expression");
  }
  if (edit.kind === "search-expression-add") {
    return prepareExpressionAddition(
      edit.searchNodeId,
      current.expression,
      edit.parentExpressionId,
      edit.expression,
      edit.anchor,
      available,
      actionId,
    );
  }
  return prepareExpressionEdit(current.expression, edit, available);
}

export function prepareExpressionAddition(
  expressionHostId: string,
  expression: SearchExpressionSpec,
  parentExpressionId: FactActionId,
  draft: SearchExpressionDraft,
  anchor: SequenceAnchor,
  available: InterpretedProjection,
  actionId: (actionIndex: number) => FactActionId,
): AuthoredActionBatch {
  requireChildAcceptingParent(expression, parentExpressionId);
  return authoredActionBatch(
    searchExpressionDraftActions(expressionHostId, draft, anchor, available, actionId, { parentExpressionId }),
  );
}

type ExpressionEdit = Readonly<
  | { kind: "search-expression-configure"; expressionId: FactActionId; clause: SearchClause }
  | {
      kind: "search-expression-move";
      expressionId: FactActionId;
      parentExpressionId: FactActionId | null;
      anchor: SequenceAnchor;
    }
  | { kind: "search-expression-remove"; expressionId: FactActionId }
>;

export function prepareExpressionEdit(
  expression: SearchExpressionSpec,
  edit: ExpressionEdit,
  available: InterpretedProjection,
): AuthoredActionBatch {
  const current = requireExpression(expression, edit.expressionId);
  if (edit.kind === "search-expression-configure") {
    validateSearchClauseTargets(edit.clause, available);
    if (!acceptsChildCount(edit.clause.kind, childCount(current))) {
      throw new Error("Search Expression configuration would make the Expression tree invalid");
    }
    if (canonicalJson(clauseOf(current)) === canonicalJson(edit.clause)) {
      throw new Error("Search Expression configuration has no effect");
    }
    return singleAuthoredActionBatch({ kind: edit.kind, expressionId: edit.expressionId, clause: edit.clause });
  }
  if (edit.kind === "search-expression-move") {
    const currentParent = findParent(expression, edit.expressionId);
    if (currentParent === undefined) {
      throw new Error("Search root Expression cannot be moved");
    }
    if (edit.parentExpressionId === null) {
      throw new Error("Search Expression cannot be moved to the root");
    }
    const nextParent = requireChildAcceptingParent(expression, edit.parentExpressionId);
    if (containsExpression(current, edit.parentExpressionId)) {
      throw new Error("Search Expression cannot be moved beneath itself");
    }
    if (currentParent.expressionId !== nextParent.expressionId && !canReleaseChild(currentParent)) {
      throw new Error("Search Expression move would make its previous parent invalid");
    }
    return singleAuthoredActionBatch({
      kind: edit.kind,
      expressionId: edit.expressionId,
      parentExpressionId: edit.parentExpressionId,
      anchor: edit.anchor,
    });
  }
  const currentParent = findParent(expression, edit.expressionId);
  if (currentParent !== undefined && !canReleaseChild(currentParent)) {
    throw new Error("Search Expression removal would make its parent invalid");
  }
  return singleAuthoredActionBatch({ kind: edit.kind, expressionId: edit.expressionId });
}

function appendDraft(
  actions: Extract<ReturnType<typeof searchAdd>, { kind: "search-expression-add" }>[],
  draft: SearchExpressionDraft,
  hostId: string,
  parentExpressionId: FactActionId | null,
  anchor: Extract<ReturnType<typeof searchAdd>, { kind: "search-expression-add" }>["anchor"],
  actionId: (actionIndex: number) => FactActionId,
): void {
  const id = actionId(actions.length);
  actions.push(searchAdd(hostId, parentExpressionId, clauseOfDraft(draft), anchor));
  const children =
    draft.kind === "and" || draft.kind === "or" ? draft.operands : draft.kind === "not" ? [draft.operand] : [];
  let previousOccurrenceId: string | null = null;
  for (const child of children) {
    const childId = actionId(actions.length);
    appendDraft(
      actions,
      child,
      hostId,
      id,
      {
        after: previousOccurrenceId,
        before: null,
        affinity: "after",
        fallback: previousOccurrenceId === null ? "start" : "end",
      },
      actionId,
    );
    previousOccurrenceId = searchExpressionProjectionIdentity(childId).expressionOccurrenceId;
  }
}

function searchAdd(
  expressionHostId: string,
  parentExpressionId: FactActionId | null,
  clause: SearchClause,
  anchor: Extract<EditAction, { kind: "search-expression-create" }>["anchor"],
) {
  return { kind: "search-expression-add" as const, expressionHostId, parentExpressionId, clause, anchor };
}

function requireExpression(expression: SearchExpressionSpec, expressionId: FactActionId): SearchExpressionSpec {
  const found = findExpression(expression, expressionId);
  if (!found) {
    throw new Error("Search Expression identity is absent");
  }
  return found;
}

function requireChildAcceptingParent(
  expression: SearchExpressionSpec,
  expressionId: FactActionId,
): Extract<SearchExpressionSpec, { kind: "and" | "or" }> {
  const parent = requireExpression(expression, expressionId);
  if (parent.kind !== "and" && parent.kind !== "or") {
    throw new Error("Search Expression parent cannot accept another operand");
  }
  return parent;
}

function findExpression(
  expression: SearchExpressionSpec,
  expressionId: FactActionId,
): SearchExpressionSpec | undefined {
  const nodeId = searchExpressionProjectionIdentity(expressionId).expressionNodeId;
  if (expression.expressionNodeId === nodeId) {
    return expression;
  }
  const children =
    expression.kind === "and" || expression.kind === "or"
      ? expression.operands
      : expression.kind === "not"
        ? [expression.operand]
        : [];
  return children.map((child) => findExpression(child, expressionId)).find((candidate) => candidate !== undefined);
}

function findParent(expression: SearchExpressionSpec, expressionId: FactActionId): SearchExpressionSpec | undefined {
  const children = childrenOf(expression);
  if (children.some((child) => child.expressionId === expressionId)) {
    return expression;
  }
  return children.map((child) => findParent(child, expressionId)).find((candidate) => candidate !== undefined);
}

function containsExpression(expression: SearchExpressionSpec, expressionId: FactActionId): boolean {
  return (
    expression.expressionId === expressionId ||
    childrenOf(expression).some((child) => containsExpression(child, expressionId))
  );
}

function childrenOf(expression: SearchExpressionSpec): readonly SearchExpressionSpec[] {
  return expression.kind === "and" || expression.kind === "or"
    ? expression.operands
    : expression.kind === "not"
      ? [expression.operand]
      : [];
}

function childCount(expression: SearchExpressionSpec): number {
  return childrenOf(expression).length;
}

function acceptsChildCount(kind: SearchClause["kind"], count: number): boolean {
  if (kind === "and" || kind === "or") {
    return count >= 1;
  }
  if (kind === "not") {
    return count === 1;
  }
  return count === 0;
}

function canReleaseChild(parent: SearchExpressionSpec): boolean {
  return (parent.kind === "and" || parent.kind === "or") && parent.operands.length > 1;
}

function clauseOfDraft(draft: SearchExpressionDraft): SearchClause {
  if (draft.kind === "and" || draft.kind === "or" || draft.kind === "not") {
    return { kind: draft.kind };
  }
  return draft;
}

function clauseOf(expression: SearchExpressionSpec): SearchClause {
  if (expression.kind === "and" || expression.kind === "or" || expression.kind === "not") {
    return { kind: expression.kind };
  }
  const { expressionId: _expressionId, expressionNodeId: _expressionNodeId, ...clause } = expression;
  return clause;
}

function validateSearchClauseTargets(clause: SearchClause, available: InterpretedProjection): void {
  if (clause.kind === "supertag") {
    if (available.nodes[clause.supertagId]?.intrinsicNodeType !== "supertag-definition") {
      throw new Error("Search Expression Supertag is not active");
    }
  } else if (clause.kind === "field-defined" || clause.kind === "field-value" || clause.kind === "date-compare") {
    if (available.nodes[clause.fieldDefinitionId]?.intrinsicNodeType !== "field-definition") {
      throw new Error("Search Expression Field Definition is not active");
    }
    if (clause.kind === "field-value" && clause.value.kind === "node" && !available.nodes[clause.value.nodeId]) {
      throw new Error("Search Expression Field value Node is not active");
    }
  } else if (
    (clause.kind === "descendant-of" || clause.kind === "child-of") &&
    clause.target.kind === "node" &&
    !available.nodes[clause.target.nodeId]
  ) {
    throw new Error("Search Expression scope target is not active");
  } else if (clause.kind === "links-to" && !available.nodes[clause.targetNodeId]) {
    throw new Error("Search Expression links-to target is not active");
  }
}
