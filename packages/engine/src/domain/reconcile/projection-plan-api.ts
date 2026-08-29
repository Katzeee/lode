import type { FactSnapshot, ProjectionPerspective } from "../fact/index.js";
import { PROJECTION_PLAN } from "./projection-plan.js";
import { createProjectionPlanContext } from "./projection-plan-context.js";
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
  const context = createProjectionPlanContext(workspaceId, snapshot, perspective, versions, originActivation);
  PROJECTION_PLAN.run(context);
  if (!context.projection) {
    throw new Error("Projection owner plan did not assemble a Projection");
  }
  return {
    projection: context.projection,
    activation: context.activation.evidence,
  };
}
