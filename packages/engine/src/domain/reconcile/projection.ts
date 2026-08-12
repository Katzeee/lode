import type { FactSnapshot, ViewMode } from "../fact/index.js";
import { projectWithOwnerPlan } from "./projection-owner-api.js";
import type { ProjectionOwnerObserver } from "./projection-owner-context.js";
import type { Projection, ProjectionVersions } from "./projection-types.js";

export function projectSnapshot(
  workspaceId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
  versions: ProjectionVersions,
  observer?: ProjectionOwnerObserver,
): Projection {
  return projectWithOwnerPlan(workspaceId, snapshot, view, versions, observer).projection;
}

export function projectionText(projection: Projection, nodeId: string): string {
  return projection.nodes[nodeId]?.text.map((atom) => atom.value).join("") ?? "";
}
