import type { ContributionFact, FactSnapshot, ViewMode } from "../fact/index.js";
import type { OwnerKey } from "./owner-dag.js";
import { PROJECTION_OWNER_DAG } from "./projection-owner-plan.js";
import {
  emptyOwnerContext,
  incrementalOwnerContext,
  type ProjectionOwnerObserver,
} from "./projection-owner-context.js";
import type { Projection, ProjectionOwnerCache, ProjectionVersions } from "./projection-types.js";

export function projectWithOwnerPlan(
  workspaceId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
  versions: ProjectionVersions,
  observer?: ProjectionOwnerObserver,
): Readonly<{
  projection: Projection;
  ownerCache: ProjectionOwnerCache;
  evaluatedOwners: readonly OwnerKey[];
}> {
  const context = emptyOwnerContext(workspaceId, snapshot, view, versions, observer);
  const evaluatedOwners = PROJECTION_OWNER_DAG.run(context);
  if (!context.projection) {
    throw new Error("Projection owner plan did not assemble a Projection");
  }
  return { projection: context.projection, ownerCache: context.ownerCache, evaluatedOwners };
}

export function advanceWithOwnerPlan(
  workspaceId: string,
  previous: Projection,
  previousCache: ProjectionOwnerCache,
  snapshot: FactSnapshot,
  activeTail: readonly ContributionFact[],
  versions: ProjectionVersions,
  selected: ReadonlySet<OwnerKey>,
  observer?: ProjectionOwnerObserver,
): Readonly<{
  projection: Projection;
  ownerCache: ProjectionOwnerCache;
  evaluatedOwners: readonly OwnerKey[];
}> {
  const context = incrementalOwnerContext(
    workspaceId,
    previous,
    previousCache,
    snapshot,
    activeTail,
    versions,
    selected,
    observer,
  );
  const evaluatedOwners = PROJECTION_OWNER_DAG.run(context, selected);
  if (!context.projection) {
    throw new Error("Incremental owner plan did not assemble a Projection");
  }
  return { projection: context.projection, ownerCache: context.ownerCache, evaluatedOwners };
}
