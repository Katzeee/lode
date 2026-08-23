import { type Fact, type FactSnapshot } from "../fact/index.js";
import { selectEligibleDirectTail } from "./direct-tail/index.js";
import type { ProjectionStageKey } from "./projection-plan-dag.js";
import { advanceWithPlan } from "./projection-plan-api.js";
import type { Projection, ProjectionPlanCache, ProjectionVersions } from "./projection-types.js";

export function advanceDirectProjection(
  workspaceId: string,
  previous: Projection,
  previousCache: ProjectionPlanCache,
  snapshot: FactSnapshot,
  changed: readonly Fact[],
  versions: ProjectionVersions,
  selectedStages: ReadonlySet<ProjectionStageKey>,
  originPlanCache: ProjectionPlanCache | null = null,
): Readonly<{
  projection: Projection;
  planCache: ProjectionPlanCache;
}> | null {
  const actions = selectEligibleDirectTail(previous, snapshot.facts, changed);
  if (!actions) {
    return null;
  }
  return advanceWithPlan(
    workspaceId,
    previous,
    previousCache,
    snapshot,
    actions,
    versions,
    selectedStages,
    originPlanCache,
  );
}
