import {
  isSearchAction,
  searchClauseFromSpec,
  type FactAction,
  type FactActionId,
  type SearchExpressionSpec,
} from "../fact/index.js";
import {
  searchExpressionActionId,
  searchExpressionProjectionIdentity,
  occurrenceAnchor,
  type InterpretedProjection,
} from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateSearchAction(
  target: FactAction,
  counterfactual: InterpretedProjection,
): CompensationStep | null {
  const action = target.action;
  if (!isSearchAction(action)) {
    return null;
  }
  if (action.kind === "search-expression-add") {
    return { kind: "ready", actions: [{ kind: "search-expression-remove", expressionId: target.id }] };
  }
  if (action.kind === "search-expression-remove") {
    return { kind: "ready", actions: [{ kind: "search-expression-restore", expressionId: action.expressionId }] };
  }
  if (action.kind === "search-expression-restore") {
    return { kind: "ready", actions: [{ kind: "search-expression-remove", expressionId: action.expressionId }] };
  }
  const state = findProjectedExpression(counterfactual, action.expressionId);
  if (!state) {
    return noCompensation();
  }
  if (action.kind === "search-expression-configure") {
    return {
      kind: "ready",
      actions: [
        { kind: "search-expression-configure", expressionId: action.expressionId, clause: searchClauseFromSpec(state) },
      ],
    };
  }
  const identity = searchExpressionProjectionIdentity(action.expressionId);
  const occurrence = counterfactual.occurrences[identity.expressionOccurrenceId];
  if (!occurrence) {
    return noCompensation();
  }
  const parentExpressionId = searchExpressionActionId(occurrence.parentNodeId);
  return {
    kind: "ready",
    actions: [
      {
        kind: "search-expression-move",
        expressionId: action.expressionId,
        parentExpressionId,
        anchor: occurrenceAnchor(counterfactual, identity.expressionOccurrenceId),
      },
    ],
  };
}

function findProjectedExpression(
  projection: InterpretedProjection,
  expressionId: FactActionId,
): SearchExpressionSpec | null {
  const nodeId = searchExpressionProjectionIdentity(expressionId).expressionNodeId;
  for (const search of Object.values(projection.searchExpressions)) {
    const found = findExpression(search.expression, nodeId);
    if (found) {
      return found;
    }
  }
  return null;
}

function findExpression(expression: SearchExpressionSpec, nodeId: string): SearchExpressionSpec | null {
  if (expression.expressionNodeId === nodeId) {
    return expression;
  }
  const children =
    expression.kind === "and" || expression.kind === "or"
      ? expression.operands
      : expression.kind === "not"
        ? [expression.operand]
        : [];
  for (const child of children) {
    const found = findExpression(child, nodeId);
    if (found) {
      return found;
    }
  }
  return null;
}
