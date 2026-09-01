import {
  findSearchExpression,
  isSearchAction,
  isFactActionId,
  proposableActionKindsInFamily,
  searchClauseFromSpec,
  type FactAction,
  type FactActionId,
} from "../fact/index.js";
import {
  searchExpressionActionId,
  searchExpressionProjectionIdentity,
  occurrenceAnchor,
  type InterpretedProjection,
  type InterpretedProjectionGeneration,
} from "../reconcile/index.js";
import { defineReviewFamily, originReviewChanged } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { SearchExpressionDecisionEffect, SearchExpressionDecisionState } from "./types.js";

const SEARCH_ACTION_KINDS = proposableActionKindsInFamily("search");

export const searchExpressionReviewFamily = defineReviewFamily<
  (typeof SEARCH_ACTION_KINDS)[number],
  FactActionId,
  SearchExpressionDecisionEffect
>({
  key: "search-expression",
  actionKinds: SEARCH_ACTION_KINDS,
  scopes(fact) {
    const expressionId = expressionIdentity(fact);
    const identity = searchExpressionProjectionIdentity(expressionId);
    return [
      reviewScope("search-expression", expressionId),
      associatedNodeScope(identity.expressionNodeId),
      ...(fact.action.kind === "search-expression-add" && !isFactActionId(fact.action.expressionHostId)
        ? [associatedNodeScope(fact.action.expressionHostId)]
        : []),
    ];
  },
  identify: (fact) => expressionIdentity(fact),
  effect: (_fact, expressionId, generation) => expressionEffect(expressionId, generation),
  changed: originReviewChanged,
  diffKind: "search-expression",
  effectIdentity: (expressionId) => `search-expression/${expressionId}`,
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      if (!isSearchAction(fact.action)) {
        continue;
      }
      const expressionId = expressionIdentity(fact);
      const identity = searchExpressionProjectionIdentity(expressionId);
      impacts.add(expressionId);
      impacts.add(identity.expressionNodeId);
      const effect = expressionEffect(expressionId, generation);
      for (const state of [effect.origin, effect.review]) {
        if (state?.hostId) {
          impacts.add(state.hostId);
        }
      }
    }
  },
});

function expressionEffect(
  expressionId: FactActionId,
  generation: InterpretedProjectionGeneration,
): SearchExpressionDecisionEffect {
  return {
    kind: "search-expression",
    expressionId,
    origin: expressionState(expressionId, generation.origin),
    review: expressionState(expressionId, generation.review),
  };
}

function expressionState(
  expressionId: FactActionId,
  projection: InterpretedProjection,
): SearchExpressionDecisionState | null {
  const identity = searchExpressionProjectionIdentity(expressionId);
  if (!projection.nodes[identity.expressionNodeId]) {
    return null;
  }
  const occurrence = projection.occurrences[identity.expressionOccurrenceId];
  const located = locateExpression(projection, expressionId);
  return {
    present: occurrence !== undefined,
    hostId: located?.hostId ?? null,
    parentExpressionId: occurrence ? searchExpressionActionId(occurrence.parentNodeId) : null,
    anchor: occurrence ? occurrenceAnchor(projection, identity.expressionOccurrenceId) : null,
    clause: located ? searchClauseFromSpec(located.expression) : null,
  };
}

function locateExpression(
  projection: InterpretedProjection,
  expressionId: FactActionId,
): Readonly<{ hostId: string; expression: NonNullable<ReturnType<typeof findSearchExpression>> }> | null {
  for (const [hostId, search] of Object.entries(projection.searchExpressions)) {
    const expression = findSearchExpression(search.expression, expressionId);
    if (expression !== undefined) {
      return { hostId, expression };
    }
  }
  for (const view of Object.values(projection.sharedDefaultViewDefinitions).flat()) {
    const filter = view.options.filter;
    if (!filter) {
      continue;
    }
    const expression = findSearchExpression(filter.expression, expressionId);
    if (expression !== undefined) {
      return { hostId: filter.filterId, expression };
    }
  }
  return null;
}

function expressionIdentity(fact: FactAction): FactActionId {
  if (!isSearchAction(fact.action)) {
    throw new Error("Search Review family received another AuthoredAction family");
  }
  return fact.action.kind === "search-expression-add" ? fact.id : fact.action.expressionId;
}
