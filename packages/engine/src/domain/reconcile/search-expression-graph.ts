import {
  canonicalJson,
  causalMaxima,
  factObserves,
  isFactActionId,
  SEARCH_EXPRESSION_DEFINITION_NODE_ID,
  type FactAction,
  type FactActionId,
  type FactActionOf,
  type SearchClause,
  type SequenceAnchor,
} from "../fact/index.js";
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
  const additions = active.filter(
    (action): action is FactActionOf<"search-expression-add"> => action.action.kind === "search-expression-add",
  );
  const removals = active.filter(
    (action): action is FactActionOf<"search-expression-remove"> => action.action.kind === "search-expression-remove",
  );
  const restores = active.filter(
    (action): action is FactActionOf<"search-expression-restore"> => action.action.kind === "search-expression-restore",
  );
  return additions.map((addition) => {
    const supports: readonly FactAction[] = [
      addition,
      ...restores.filter((restore) => restore.action.expressionId === addition.id),
    ];
    const removed = supports.every((support) =>
      removals.some((removal) => removal.action.expressionId === addition.id && actionObserves(removal, support)),
    );
    const configurations = causalMaxima(
      active.filter(
        (action): action is FactActionOf<"search-expression-configure"> =>
          action.action.kind === "search-expression-configure" && action.action.expressionId === addition.id,
      ),
      (left, right) => left.action.expressionId === right.action.expressionId,
    );
    const clauses =
      configurations.length === 0 ? [addition.action.clause] : configurations.map((value) => value.action.clause);
    const uniqueClauses = new Map(clauses.map((clause) => [canonicalJson(clause), clause]));
    const moves = causalMaxima(
      active.filter(
        (action): action is FactActionOf<"search-expression-move"> =>
          action.action.kind === "search-expression-move" && action.action.expressionId === addition.id,
      ),
      (left, right) => left.action.expressionId === right.action.expressionId,
    );
    const positions =
      moves.length === 0
        ? [{ parentExpressionId: addition.action.parentExpressionId, anchor: addition.action.anchor }]
        : moves.map((move) => ({ parentExpressionId: move.action.parentExpressionId, anchor: move.action.anchor }));
    const uniquePositions = new Map(positions.map((position) => [canonicalJson(position), position]));
    const position = [...uniquePositions.values()][0];
    return {
      addition,
      removed,
      clause: uniqueClauses.size === 1 ? ([...uniqueClauses.values()][0] ?? null) : null,
      parentExpressionId: position?.parentExpressionId ?? null,
      anchor: position?.anchor ?? addition.action.anchor,
      positionConflicted: uniquePositions.size > 1,
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

function actionObserves(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}

const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;
