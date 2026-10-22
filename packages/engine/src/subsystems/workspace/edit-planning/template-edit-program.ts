import type { FactActionId, GraphAction } from "../../../domain/fact/index.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";
import { requireAuthoredActionBatch } from "./action-batch.js";
import { expandGraphAction } from "./graph-action-expansion.js";

/** Tracks the actual lowered action indices used by content identities and initialization. */
export function templateEditProgram(
  available: InterpretedProjection,
  finalActionId: (index: number) => FactActionId,
  preview: (actions: readonly GraphAction[]) => InterpretedProjection,
) {
  const actions: GraphAction[] = [];
  let current = available;
  return {
    actions,
    current: () => current,
    finalActionId: (index: number) => finalActionId(actions.length + index),
    append: (...planned: readonly GraphAction[]) => {
      for (const action of planned) {
        actions.push(...expandGraphAction(action, current));
        current = preview(requireAuthoredActionBatch(actions));
      }
    },
    appendContent: (planned: readonly GraphAction[]) => {
      actions.push(...planned);
      current = preview(requireAuthoredActionBatch(actions));
    },
  };
}
