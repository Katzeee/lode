import type { GraphAction } from "../../../domain/fact/index.js";
import { validateAuthoredIntent } from "../../../domain/authored-intent/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

export function validatePlannedAction(
  action: GraphAction,
  previous: ScopedProjection,
  available: ScopedProjection,
  resulting: ScopedProjection,
): GraphAction {
  return validateAuthoredIntent(action, {
    projections: () => ({ previous, available, resulting }),
  });
}
