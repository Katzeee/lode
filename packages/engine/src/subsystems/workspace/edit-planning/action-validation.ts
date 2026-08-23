import type { AuthoredAction } from "../../../domain/fact/index.js";
import { validateAuthoredIntent } from "../../../domain/authored-intent/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

export function validatePlannedAction(
  action: AuthoredAction,
  previous: ScopedProjection,
  available: ScopedProjection,
  resulting: ScopedProjection,
): AuthoredAction {
  return validateAuthoredIntent(action, {
    projections: () => ({ previous, available, resulting }),
  });
}
