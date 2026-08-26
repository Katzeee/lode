import {
  factActionsOfKind,
  isFactActionId,
  SEARCH_EXPRESSION_DEFINITION_NODE_ID,
  type FactAction,
  type FactActionId,
  type FactActionOf,
  type SearchClause,
  type SequenceAnchor,
} from "../fact/index.js";
import { causalCollectionStates } from "./causal-collection.js";
import { metanodeNodeId } from "./projection-identity.js";

type SearchExpressionProjectionIdentity = Readonly<{
  expressionNodeId: string;
  expressionOccurrenceId: string;
  definitionOccurrenceId: string;
}>;

export type SearchExpressionState = Readonly<{
  addition: FactActionOf<"search-expression-add">;
  removed: boolean;
  clause: SearchClause | null;
  parentExpressionId: FactActionId | null;
  anchor: SequenceAnchor;
  positionConflicted: boolean;
  identity: SearchExpressionProjectionIdentity;
}>;

export function searchExpressionProjectionIdentity(actionId: FactActionId): SearchExpressionProjectionIdentity {
  const root = `${actionId}/projection/search-expression`;
  return {
    expressionNodeId: `${root}/node`,
    expressionOccurrenceId: `${root}/occurrence`,
    definitionOccurrenceId: `${root}/definition-occurrence`,
  };
}

export function searchExpressionActionId(expressionNodeId: string): FactActionId | null {
  const suffix = "/projection/search-expression/node";
  if (!expressionNodeId.endsWith(suffix)) {
    return null;
  }
  const actionId = expressionNodeId.slice(0, -suffix.length);
  return isFactActionId(actionId) ? actionId : null;
}

export function searchExpressionStates(active: readonly FactAction[]): readonly SearchExpressionState[] {
  return causalCollectionStates(active, "search-expression").map((state) => {
    const { addition, removed } = state;
    const configurations = factActionsOfKind(
      state.registers.get("clause")?.candidates ?? [],
      "search-expression-configure",
    );
    const clauses =
      configurations.length === 0 ? [addition.action.clause] : configurations.map((value) => value.action.clause);
    const clauseState = state.registers.get("clause");
    const moves = factActionsOfKind(state.registers.get("position")?.candidates ?? [], "search-expression-move");
    const positions =
      moves.length === 0
        ? [{ parentExpressionId: addition.action.parentExpressionId, anchor: addition.action.anchor }]
        : moves.map((move) => ({ parentExpressionId: move.action.parentExpressionId, anchor: move.action.anchor }));
    const position = positions[0];
    return {
      addition,
      removed,
      clause: clauseState?.conflicted === true ? null : (clauses[0] ?? null),
      parentExpressionId: position?.parentExpressionId ?? null,
      anchor: position?.anchor ?? addition.action.anchor,
      positionConflicted: state.registers.get("position")?.conflicted ?? false,
      identity: searchExpressionProjectionIdentity(addition.id),
    };
  });
}

export function searchExpressionStateByAction(
  active: readonly FactAction[],
): ReadonlyMap<FactActionId, SearchExpressionState> {
  return new Map(searchExpressionStates(active).map((state) => [state.addition.id, state]));
}

export function searchExpressionPlacementIds(
  action: FactAction,
  states: ReadonlyMap<FactActionId, SearchExpressionState>,
): readonly string[] {
  const state = states.get(action.id);
  return state === undefined || state.removed || state.positionConflicted
    ? []
    : [state.identity.expressionOccurrenceId, state.identity.definitionOccurrenceId];
}

export function searchExpressionPlacement(
  state: SearchExpressionState,
  placementId: string,
): Readonly<{ nodeId: string; parentNodeId: string; anchor: SequenceAnchor; derived: true }> | null {
  const { identity } = state;
  if (placementId === identity.expressionOccurrenceId) {
    const parentNodeId = state.parentExpressionId
      ? searchExpressionProjectionIdentity(state.parentExpressionId).expressionNodeId
      : expressionHostParent(state.addition.action.expressionHostId);
    return { nodeId: identity.expressionNodeId, parentNodeId, anchor: state.anchor, derived: true };
  }
  return placementId === identity.definitionOccurrenceId
    ? {
        nodeId: SEARCH_EXPRESSION_DEFINITION_NODE_ID,
        parentNodeId: identity.expressionNodeId,
        anchor: start,
        derived: true,
      }
    : null;
}

export function expressionHostParent(expressionHostId: string): string {
  return isFactActionId(expressionHostId)
    ? `${expressionHostId}/projection/view-filter/node`
    : metanodeNodeId(expressionHostId);
}

const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;
