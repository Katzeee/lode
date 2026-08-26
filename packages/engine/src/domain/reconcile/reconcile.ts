import { compareCausalOrder, frontierCovers, frontierEquals, type FactSnapshot } from "../fact/index.js";
import { advanceDirectProjection } from "./incremental-projection.js";
import { invalidatedProjectionStages, PROJECTION_PLAN } from "./projection-plan.js";
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
  const review = projectWithPlan(workspaceId, snapshot, "review", versions, origin.planCache);
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
    planCaches: { origin: origin.planCache, review: review.planCache },
  };
}

export function advanceGeneration(
  workspaceId: string,
  previousSnapshot: FactSnapshot,
  nextSnapshot: FactSnapshot,
  versions: ProjectionVersions,
  previousGeneration?: ProjectionGeneration,
): ProjectionGeneration {
  assertSupportedProjectionVersions(versions);
  if (!frontierCovers(nextSnapshot.frontier, previousSnapshot.frontier)) {
    throw new Error("Incremental snapshot does not contain the previous frontier");
  }
  const previousIds = new Set(previousSnapshot.facts.map((fact) => fact.id));
  const changed = nextSnapshot.facts.filter((fact) => !previousIds.has(fact.id));
  const invalidated = invalidatedProjectionStages(changed);
  const selectedStages = new Set(PROJECTION_PLAN.downstream(invalidated));
  if (changed.some((fact) => fact.body.kind === "action")) {
    selectedStages.add("activation");
  }
  if (
    previousGeneration &&
    frontierEquals(previousGeneration.identity.frontier, previousSnapshot.frontier) &&
    previousGeneration.identity.rulesVersion === versions.rulesVersion &&
    previousGeneration.identity.schemaVersion === versions.schemaVersion
  ) {
    const origin = advanceDirectProjection(
      workspaceId,
      previousGeneration.origin,
      previousGeneration.planCaches.origin,
      nextSnapshot,
      changed,
      versions,
      selectedStages,
    );
    const review = origin
      ? advanceDirectProjection(
          workspaceId,
          previousGeneration.review,
          previousGeneration.planCaches.review,
          nextSnapshot,
          changed,
          versions,
          selectedStages,
          origin.planCache,
        )
      : null;
    if (origin && review) {
      return {
        identity: origin.projection.identity,
        origin: origin.projection,
        review: review.projection,
        planCaches: { origin: origin.planCache, review: review.planCache },
      };
    }
  }
  return rebuildGeneration(workspaceId, nextSnapshot, versions);
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
