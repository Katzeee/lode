import {
  compareCausalOrder,
  factActionsFromFacts,
  type FactAction,
  type FactSnapshot,
  type ProjectionPerspective,
} from "../fact/index.js";
import { deriveActivation, deriveSupport } from "../activation/index.js";
import type { ProjectionPlanCache } from "./projection-types.js";

export function activeFactActions(
  snapshot: FactSnapshot,
  perspective: ProjectionPerspective,
): Readonly<{ actions: readonly FactAction[]; cache: ProjectionPlanCache }> {
  const allActions = factActionsFromFacts(snapshot.facts);
  const activation = deriveActivation(snapshot.facts, perspective, allActions);
  const actions = allActions.filter((action) => activation.activeActionIds.has(action.id)).sort(compareCausalOrder);
  return {
    actions,
    cache: {
      activeActionIds: actions.map((action) => action.id),
      supportByAction: Object.fromEntries(activation.supportByAction),
    },
  };
}

export function activeActionsFromCache(
  snapshot: FactSnapshot,
  previous: ProjectionPlanCache,
  tail: readonly FactAction[],
): readonly FactAction[] {
  const ids = new Set([...previous.activeActionIds, ...tail.map((fact) => fact.id)]);
  return factActionsFromFacts(snapshot.facts)
    .filter((fact) => ids.has(fact.id))
    .sort(compareCausalOrder);
}

export function incrementalPlanCache(
  previous: ProjectionPlanCache,
  tail: readonly FactAction[],
  snapshot: FactSnapshot,
): ProjectionPlanCache {
  const active = activeActionsFromCache(snapshot, previous, tail);
  const support = deriveSupport(active, new Set(active.map((fact) => fact.id)));
  return {
    activeActionIds: [...previous.activeActionIds, ...tail.map((fact) => fact.id)],
    supportByAction: {
      ...previous.supportByAction,
      ...Object.fromEntries(tail.map((fact) => [fact.id, support.get(fact.id) ?? []])),
    },
  };
}
