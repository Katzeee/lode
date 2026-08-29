import type { GraphAction } from "../../../domain/fact/index.js";
import { validateAuthoredIntent } from "../../../domain/authored-intent/index.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";

export function validatePlannedAction(
  action: GraphAction,
  previous: InterpretedProjection,
  available: InterpretedProjection,
  resulting: InterpretedProjection,
): GraphAction {
  return validateAuthoredIntent(action, {
    projections: () => ({ previous, available, resulting }),
  });
}
