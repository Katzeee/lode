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
): Readonly<{
  projection: Projection;
  planCache: ProjectionPlanCache;
}> | null {
  const contributions = selectEligibleDirectTail(previous, snapshot.facts, changed);
  if (!contributions) {
    return null;
  }
  return advanceWithPlan(workspaceId, previous, previousCache, snapshot, contributions, versions, selectedStages);
}
