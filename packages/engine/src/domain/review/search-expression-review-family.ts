import {
  canonicalJson,
  compareCausalOrder,
  isSearchAction,
  isFactActionId,
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
  type InterpretedProjectionGeneration,
} from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { SearchExpressionDecisionEffect, SearchExpressionDecisionState } from "./types.js";

const SEARCH_ACTION_KINDS = [
  "search-expression-add",
  "search-expression-configure",
  "search-expression-move",
  "search-expression-remove",
  "search-expression-restore",
] as const;

export const searchExpressionReviewFamily = {
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
  candidates: ({ generation, pending }) => candidates(generation, pending),
  effect(fact, _targets, generation) {
    const expressionId = expressionIdentity(fact);
    const effect = expressionEffect(expressionId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? null
      : { identity: `search-expression/${expressionId}`, effect };
  },
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
} satisfies ReviewFamilyRule;

function candidates(
  generation: InterpretedProjectionGeneration,
  pending: ReadonlyMap<FactActionId, FactAction>,
): readonly HunkCandidate[] {
  const groups = new Map<FactActionId, FactAction[]>();
  for (const fact of pending.values()) {
    if (!isSearchAction(fact.action)) {
      continue;
    }
    const id = expressionIdentity(fact);
    const group = groups.get(id) ?? [];
    group.push(fact);
    groups.set(id, group);
  }
  return [...groups].flatMap(([expressionId, facts]) => {
    const effect = expressionEffect(expressionId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? []
      : [
          {
            diffSpace: { kind: "search-expression" as const, identity: expressionId },
            targets: [...facts].sort(compareCausalOrder).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

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
  const located = locateExpression(projection, identity.expressionNodeId);
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
  nodeId: string,
): Readonly<{ hostId: string; expression: SearchExpressionSpec }> | null {
  for (const [hostId, search] of Object.entries(projection.searchExpressions)) {
    const expression = findExpression(search.expression, nodeId);
    if (expression) {
      return { hostId, expression };
    }
  }
  for (const view of Object.values(projection.sharedDefaultViewDefinitions).flat()) {
    const filter = view.options.filter;
    if (!filter) {
      continue;
    }
    const expression = findExpression(filter.expression, nodeId);
    if (expression) {
      return { hostId: filter.filterId, expression };
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

function expressionIdentity(fact: FactAction): FactActionId {
  if (!isSearchAction(fact.action)) {
    throw new Error("Search Review family received another AuthoredAction family");
  }
  return fact.action.kind === "search-expression-add" ? fact.id : fact.action.expressionId;
}
