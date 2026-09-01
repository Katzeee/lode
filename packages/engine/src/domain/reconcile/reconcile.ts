import { frontierEquals, type FactSnapshot } from "../fact/index.js";
import { projectWithPlan } from "./projection-plan-api.js";
import type { ProjectionGeneration } from "./projection-types.js";
import { assertSupportedProjectionVersions, type ProjectionVersions } from "./projection-versions.js";

export function rebuildGeneration(
  workspaceId: string,
  snapshot: FactSnapshot,
  versions: ProjectionVersions,
): ProjectionGeneration {
  assertSupportedProjectionVersions(versions);
  const origin = projectWithPlan(workspaceId, snapshot, "origin", versions);
  const review = projectWithPlan(workspaceId, snapshot, "review", versions, origin.activation);
  if (
    origin.projection.identity.generationId !== review.projection.identity.generationId ||
    !frontierEquals(origin.projection.identity.frontier, review.projection.identity.frontier)
  ) {
    throw new Error("Origin and Review cannot form one Projection Generation");
  }
  return {
    identity: origin.projection.identity,
    origin: origin.projection,
    review: review.projection,
    activations: { origin: origin.activation, review: review.activation },
  };
}
