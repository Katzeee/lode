import {
  factObserves,
  OPTIONAL_FIELDS_DEFINITION_NODE_ID,
  type FactAction,
  type FactActionId,
  type FactActionOf,
  type SequenceAnchor,
} from "../fact/index.js";
import { metanodeNodeId } from "./projection-identity.js";

type OptionalFieldProjectionIdentity = Readonly<{
  fieldNurseryNodeId: string;
  fieldNurseryOccurrenceId: string;
  nurseryDefinitionOccurrenceId: string;
  nurseryValueNodeId: string;
  nurseryValueOccurrenceId: string;
  contributionNodeId: string;
  contributionOccurrenceId: string;
  definitionOccurrenceId: string;
  valueNodeId: string;
  valueOccurrenceId: string;
}>;

type OptionalFieldState = Readonly<{
  addition: FactActionOf<"optional-field-contribution-add">;
  removed: boolean;
  identity: OptionalFieldProjectionIdentity;
}>;

function optionalFieldProjectionIdentity(actionId: FactActionId): OptionalFieldProjectionIdentity {
  const root = `${actionId}/projection/optional-field-contribution`;
  return {
    fieldNurseryNodeId: `${root}/nursery/node`,
    fieldNurseryOccurrenceId: `${root}/nursery/occurrence`,
    nurseryDefinitionOccurrenceId: `${root}/nursery/definition-occurrence`,
    nurseryValueNodeId: `${root}/nursery/value/node`,
    nurseryValueOccurrenceId: `${root}/nursery/value/occurrence`,
    contributionNodeId: `${root}/node`,
    contributionOccurrenceId: `${root}/occurrence`,
    definitionOccurrenceId: `${root}/definition-occurrence`,
    valueNodeId: `${root}/value/node`,
    valueOccurrenceId: `${root}/value/occurrence`,
  };
}

export function optionalFieldStates(active: readonly FactAction[]): readonly OptionalFieldState[] {
  const removals = active.filter(
    (action): action is FactActionOf<"optional-field-contribution-remove"> =>
      action.action.kind === "optional-field-contribution-remove",
  );
  const additions = active.filter(
    (action): action is FactActionOf<"optional-field-contribution-add"> =>
      action.action.kind === "optional-field-contribution-add",
  );
  return additions.map((addition): OptionalFieldState => {
    const removed = removals.some(
      (removal) =>
        removal.action.supertagId === addition.action.supertagId &&
        removal.action.fieldDefinitionId === addition.action.fieldDefinitionId &&
        actionObserves(removal, addition),
    );
    return { addition, removed, identity: optionalFieldProjectionIdentity(addition.id) };
  });
}

export function optionalFieldStateByAction(
  active: readonly FactAction[],
): ReadonlyMap<FactActionId, OptionalFieldState> {
  return new Map(optionalFieldStates(active).map((state) => [state.addition.id, state]));
}

export function optionalFieldPlacementIds(
  action: FactAction,
  states: ReadonlyMap<FactActionId, OptionalFieldState>,
): readonly string[] {
  const state = states.get(action.id);
  return state === undefined || state.removed
    ? []
    : Object.values(state.identity).filter((id) => id.endsWith("occurrence"));
}

export function optionalFieldPlacement(
  state: OptionalFieldState,
  placementId: string,
): Readonly<{ nodeId: string; parentNodeId: string; anchor: SequenceAnchor; derived: true }> | null {
  const { addition, identity } = state;
  if (state.removed) {
    return null;
  }
  const values: Readonly<Record<string, Readonly<{ nodeId: string; parentNodeId: string; anchor: SequenceAnchor }>>> = {
    [identity.fieldNurseryOccurrenceId]: {
      nodeId: identity.fieldNurseryNodeId,
      parentNodeId: metanodeNodeId(addition.action.supertagId),
      anchor: addition.action.anchor,
    },
    [identity.nurseryDefinitionOccurrenceId]: {
      nodeId: OPTIONAL_FIELDS_DEFINITION_NODE_ID,
      parentNodeId: identity.fieldNurseryNodeId,
      anchor: start,
    },
    [identity.nurseryValueOccurrenceId]: {
      nodeId: identity.nurseryValueNodeId,
      parentNodeId: identity.fieldNurseryNodeId,
      anchor: after(identity.nurseryDefinitionOccurrenceId),
    },
    [identity.contributionOccurrenceId]: {
      nodeId: identity.contributionNodeId,
      parentNodeId: identity.nurseryValueNodeId,
      anchor: addition.action.anchor,
    },
    [identity.definitionOccurrenceId]: {
      nodeId: addition.action.fieldDefinitionId,
      parentNodeId: identity.contributionNodeId,
      anchor: start,
    },
    [identity.valueOccurrenceId]: {
      nodeId: identity.valueNodeId,
      parentNodeId: identity.contributionNodeId,
      anchor: after(identity.definitionOccurrenceId),
    },
  };
  const value = values[placementId];
  return value ? { ...value, derived: true } : null;
}

function actionObserves(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}

const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;

function after(occurrenceId: string): SequenceAnchor {
  return { after: occurrenceId, before: null, affinity: "after", fallback: "end" };
}
