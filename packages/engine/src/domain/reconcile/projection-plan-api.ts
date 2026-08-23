import type { FactAction, FactSnapshot, ProjectionPerspective } from "../fact/index.js";
import type { ProjectionStageKey } from "./projection-plan-dag.js";
import { PROJECTION_PLAN, projectionReplayPolicy } from "./projection-plan.js";
import { emptyProjectionPlanContext, incrementalProjectionPlanContext } from "./projection-plan-context.js";
import type { Projection, ProjectionPlanCache, ProjectionVersions } from "./projection-types.js";

export function projectWithPlan(
  workspaceId: string,
  snapshot: FactSnapshot,
  perspective: ProjectionPerspective,
  versions: ProjectionVersions,
  originPlanCache: ProjectionPlanCache | null = null,
): Readonly<{
  projection: Projection;
  planCache: ProjectionPlanCache;
}> {
  const context = emptyProjectionPlanContext(workspaceId, snapshot, perspective, versions, originPlanCache);
  PROJECTION_PLAN.run(context);
  if (!context.projection) {
    throw new Error("Projection owner plan did not assemble a Projection");
  }
  return {
    projection: context.projection,
    planCache: context.activation.planCache,
  };
}

export function advanceWithPlan(
  workspaceId: string,
  previous: Projection,
  previousCache: ProjectionPlanCache,
  snapshot: FactSnapshot,
  activeTail: readonly FactAction[],
  versions: ProjectionVersions,
  selected: ReadonlySet<ProjectionStageKey>,
  originPlanCache: ProjectionPlanCache | null = null,
): Readonly<{
  projection: Projection;
  planCache: ProjectionPlanCache;
}> {
  const context = incrementalProjectionPlanContext(
    workspaceId,
    previous,
    previousCache,
    snapshot,
    activeTail,
    versions,
    projectionReplayPolicy(selected),
    originPlanCache,
  );
  PROJECTION_PLAN.run(context, selected);
  if (!context.projection) {
    throw new Error("Incremental owner plan did not assemble a Projection");
  }
  return {
    projection: context.projection,
    planCache: context.activation.planCache,
  };
}
