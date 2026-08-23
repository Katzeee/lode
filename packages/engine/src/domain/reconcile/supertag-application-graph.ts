import {
  factObserves,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  type FactAction,
  type FactActionId,
  type FactActionOf,
  type SequenceAnchor,
} from "../fact/index.js";
import { metanodeNodeId } from "./projection-identity.js";

export type SupertagApplicationProjectionIdentity = Readonly<{
  applicationNodeId: string;
  applicationOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  definitionOccurrenceId: string;
  detachedValueNodeId: string;
  detachedValueOccurrenceId: string;
}>;

type SupertagApplicationState = Readonly<{
  addition: FactActionOf<"supertag-application-add">;
  removed: boolean;
  identity: SupertagApplicationProjectionIdentity;
}>;

export function supertagApplicationProjectionIdentity(actionId: FactActionId): SupertagApplicationProjectionIdentity {
  const root = `${actionId}/projection/supertag-application`;
  return {
    applicationNodeId: `${root}/node`,
    applicationOccurrenceId: `${root}/occurrence`,
    relationDefinitionOccurrenceId: `${root}/relation-definition-occurrence`,
    definitionOccurrenceId: `${root}/definition-occurrence`,
    detachedValueNodeId: `${root}/detached-value/node`,
    detachedValueOccurrenceId: `${root}/detached-value/occurrence`,
  };
}

export function supertagApplicationStates(active: readonly FactAction[]): readonly SupertagApplicationState[] {
  const removals = active.filter(
    (action): action is FactActionOf<"supertag-membership-remove"> =>
      action.action.kind === "supertag-membership-remove",
  );
  const additions = active.filter(
    (action): action is FactActionOf<"supertag-application-add"> => action.action.kind === "supertag-application-add",
  );
  return additions.map((action): SupertagApplicationState => {
    const removed = removals.some(
      (removal) =>
        removal.action.hostNodeId === action.action.hostNodeId &&
        removal.action.supertagId === action.action.supertagId &&
        actionObserves(removal, action),
    );
    return { addition: action, removed, identity: supertagApplicationProjectionIdentity(action.id) };
  });
}

export function supertagApplicationPlacementIds(
  action: FactAction,
  states: ReadonlyMap<FactActionId, SupertagApplicationState>,
): readonly string[] {
  const state = states.get(action.id);
  if (state === undefined) {
    return [];
  }
  return state.removed
    ? [state.identity.relationDefinitionOccurrenceId, state.identity.detachedValueOccurrenceId]
    : [
        state.identity.applicationOccurrenceId,
        state.identity.relationDefinitionOccurrenceId,
        state.identity.definitionOccurrenceId,
      ];
}

export function supertagApplicationPlacement(
  state: SupertagApplicationState,
  placementId: string,
): Readonly<{ nodeId: string; parentNodeId: string; anchor: SequenceAnchor; derived: true }> | null {
  const identity = state.identity;
  const addition = state.addition.action;
  if (!state.removed && placementId === identity.applicationOccurrenceId) {
    return {
      nodeId: identity.applicationNodeId,
      parentNodeId: metanodeNodeId(addition.hostNodeId),
      anchor: addition.anchor,
      derived: true,
    };
  }
  if (placementId === identity.relationDefinitionOccurrenceId) {
    return {
      nodeId: NODE_SUPERTAGS_DEFINITION_NODE_ID,
      parentNodeId: identity.applicationNodeId,
      anchor: start,
      derived: true,
    };
  }
  if (!state.removed && placementId === identity.definitionOccurrenceId) {
    return {
      nodeId: addition.supertagId,
      parentNodeId: identity.applicationNodeId,
      anchor: after(identity.relationDefinitionOccurrenceId),
      derived: true,
    };
  }
  return state.removed && placementId === identity.detachedValueOccurrenceId
    ? {
        nodeId: identity.detachedValueNodeId,
        parentNodeId: identity.applicationNodeId,
        anchor: after(identity.relationDefinitionOccurrenceId),
        derived: true,
      }
    : null;
}

export function supertagApplicationStateByAction(
  active: readonly FactAction[],
): ReadonlyMap<FactActionId, SupertagApplicationState> {
  return new Map(supertagApplicationStates(active).map((state) => [state.addition.id, state]));
}

function actionObserves(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}

const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;

function after(occurrenceId: string): SequenceAnchor {
  return { after: occurrenceId, before: null, affinity: "after", fallback: "end" };
}
