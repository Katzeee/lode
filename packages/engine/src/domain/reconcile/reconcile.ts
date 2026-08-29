import { compareCausalOrder, frontierCovers, frontierEquals, type FactSnapshot } from "../fact/index.js";
import { projectWithPlan } from "./projection-plan-api.js";
import {
  assertSupportedProjectionVersions,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "./projection-types.js";

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

export function snapshotAtFrontier(snapshot: FactSnapshot, frontier: Readonly<Record<string, number>>): FactSnapshot {
  if (!frontierCovers(snapshot.frontier, frontier)) {
    throw new Error("Requested frontier is not covered by the Fact snapshot");
  }
  return {
    facts: snapshot.facts
      .filter((fact) => fact.coordinate.dot.sequence <= (frontier[fact.coordinate.dot.replicaId] ?? 0))
      .sort(compareCausalOrder),
    frontier,
  };
}
