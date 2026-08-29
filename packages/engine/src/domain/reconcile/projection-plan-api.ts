import type { FactSnapshot, ProjectionPerspective } from "../fact/index.js";
import { PROJECTION_PLAN } from "./projection-plan.js";
import { createProjectionPlanState } from "./projection-plan-context.js";
import type { Projection, ProjectionActivation, ProjectionVersions } from "./projection-types.js";

export function projectWithPlan(
  workspaceId: string,
  snapshot: FactSnapshot,
  perspective: ProjectionPerspective,
  versions: ProjectionVersions,
  originActivation: ProjectionActivation | null = null,
): Readonly<{
  projection: Projection;
  activation: ProjectionActivation;
}> {
  const state = createProjectionPlanState(workspaceId, snapshot, perspective, versions, originActivation);
  PROJECTION_PLAN.run(state);
  if (!state.projection || !state.activation) {
    throw new Error("Projection owner plan did not assemble a Projection");
  }
  return {
    projection: state.projection,
    activation: state.activation.evidence,
  };
}
