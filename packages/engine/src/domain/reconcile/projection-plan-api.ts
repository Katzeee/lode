import type { ContributionFact, FactSnapshot, ViewMode } from "../fact/index.js";
import type { ProjectionStageKey } from "./projection-plan-dag.js";
import { PROJECTION_PLAN } from "./projection-plan.js";
import {
  emptyProjectionPlanContext,
  incrementalProjectionPlanContext,
  type ProjectionStageObserver,
} from "./projection-plan-context.js";
import type { Projection, ProjectionPlanCache, ProjectionVersions } from "./projection-types.js";

export function projectWithPlan(
  workspaceId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
  versions: ProjectionVersions,
  observer?: ProjectionStageObserver,
): Readonly<{
  projection: Projection;
  planCache: ProjectionPlanCache;
  evaluatedStages: readonly ProjectionStageKey[];
}> {
  const context = emptyProjectionPlanContext(workspaceId, snapshot, view, versions, observer);
  const evaluatedStages = PROJECTION_PLAN.run(context);
  if (!context.projection) {
    throw new Error("Projection owner plan did not assemble a Projection");
  }
  return { projection: context.projection, planCache: context.planCache, evaluatedStages };
}

export function advanceWithPlan(
  workspaceId: string,
  previous: Projection,
  previousCache: ProjectionPlanCache,
  snapshot: FactSnapshot,
  activeTail: readonly ContributionFact[],
  versions: ProjectionVersions,
  selected: ReadonlySet<ProjectionStageKey>,
  observer?: ProjectionStageObserver,
): Readonly<{
  projection: Projection;
  planCache: ProjectionPlanCache;
  evaluatedStages: readonly ProjectionStageKey[];
}> {
  const context = incrementalProjectionPlanContext(
    workspaceId,
    previous,
    previousCache,
    snapshot,
    activeTail,
    versions,
    selected,
    observer,
  );
  const evaluatedStages = PROJECTION_PLAN.run(context, selected);
  if (!context.projection) {
    throw new Error("Incremental owner plan did not assemble a Projection");
  }
  return { projection: context.projection, planCache: context.planCache, evaluatedStages };
}
