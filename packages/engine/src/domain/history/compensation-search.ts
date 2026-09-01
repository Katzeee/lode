import { findSearchExpression, searchClauseFromSpec, type FactActionId } from "../fact/index.js";
import {
  searchExpressionActionId,
  searchExpressionProjectionIdentity,
  occurrenceAnchor,
  type InterpretedProjection,
} from "../reconcile/index.js";
import { noCompensation, type CompensationCatalog } from "./compensation-types.js";

export const SEARCH_COMPENSATIONS = {
  "search-expression-add": (_context, target) => ({
    kind: "ready",
    actions: [{ kind: "search-expression-remove", expressionId: target.id }],
  }),
  "search-expression-remove": (_context, { action }) => ({
    kind: "ready",
    actions: [{ kind: "search-expression-restore", expressionId: action.expressionId }],
  }),
  "search-expression-restore": (_context, { action }) => ({
    kind: "ready",
    actions: [{ kind: "search-expression-remove", expressionId: action.expressionId }],
  }),
  "search-expression-configure": ({ counterfactual }, { action }) => {
    const state = findProjectedExpression(counterfactual, action.expressionId);
    if (!state) {
      return noCompensation();
    }
    return {
      kind: "ready",
      actions: [
        { kind: "search-expression-configure", expressionId: action.expressionId, clause: searchClauseFromSpec(state) },
      ],
    };
  },
  "search-expression-move": ({ counterfactual }, { action }) => {
    const state = findProjectedExpression(counterfactual, action.expressionId);
    if (!state) {
      return noCompensation();
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
  },
} satisfies Partial<CompensationCatalog>;

function findProjectedExpression(
  projection: InterpretedProjection,
  expressionId: FactActionId,
): ReturnType<typeof findSearchExpression> | null {
  for (const search of Object.values(projection.searchExpressions)) {
    const found = findSearchExpression(search.expression, expressionId);
    if (found !== undefined) {
      return found;
    }
  }
  return null;
}
