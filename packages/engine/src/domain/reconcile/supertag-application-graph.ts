import {
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  START_SEQUENCE_ANCHOR as start,
  type FactAction,
  type FactActionId,
  type FactActionOf,
  type SequenceAnchor,
} from "../fact/index.js";
import { causalCollectionStates } from "./causal-collection.js";
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
  return causalCollectionStates(active, "supertag-application").map(
    ({ addition, removed }): SupertagApplicationState => ({
      addition,
      removed,
      identity: supertagApplicationProjectionIdentity(addition.id),
    }),
  );
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

function after(occurrenceId: string): SequenceAnchor {
  return { after: occurrenceId, before: null, affinity: "after", fallback: "end" };
}
