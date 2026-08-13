import type { FactSnapshot, ViewMode } from "../fact/index.js";
import { projectWithPlan } from "./projection-plan-api.js";
import type { ProjectionStageObserver } from "./projection-plan-context.js";
import type { Projection, ProjectionVersions } from "./projection-types.js";

export function projectSnapshot(
  workspaceId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
  versions: ProjectionVersions,
  observer?: ProjectionStageObserver,
): Projection {
  return projectWithPlan(workspaceId, snapshot, view, versions, observer).projection;
}

export function projectionText(projection: Projection, nodeId: string): string {
  return projection.nodes[nodeId]?.text.map((atom) => atom.value).join("") ?? "";
}
