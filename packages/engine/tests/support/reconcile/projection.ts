import type { FactSnapshot, ViewMode } from "../../../src/domain/fact/index.js";
import { projectWithPlan } from "../../../src/domain/reconcile/projection-plan-api.js";
import type {
  Projection,
  ProjectionVersions,
} from "../../../src/domain/reconcile/projection-types.js";

export function projectSnapshot(
  workspaceId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
  versions: ProjectionVersions,
): Projection {
  return projectWithPlan(workspaceId, snapshot, view, versions).projection;
}

export function projectionText(projection: Projection, nodeId: string): string {
  return projection.nodes[nodeId]?.text.map((atom) => atom.value).join("") ?? "";
}
