import {
  compareCausalOrder,
  factActionsFromFacts,
  type FactAction,
  type FactSnapshot,
  type ProjectionPerspective,
} from "../fact/index.js";
import { deriveActivation } from "../activation/index.js";
import type { ProjectionActivation } from "./projection-types.js";

export function activeFactActions(
  snapshot: FactSnapshot,
  perspective: ProjectionPerspective,
): Readonly<{ actions: readonly FactAction[]; activation: ProjectionActivation }> {
  const allActions = factActionsFromFacts(snapshot.facts);
  const activation = deriveActivation(snapshot.facts, perspective, allActions);
  const actions = allActions.filter((action) => activation.activeActionIds.has(action.id)).sort(compareCausalOrder);
  return {
    actions,
    activation: {
      activeActionIds: actions.map((action) => action.id),
      supportByAction: Object.fromEntries(activation.supportByAction),
    },
  };
}
