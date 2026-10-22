import type { FactSnapshot, ProjectionPerspective } from "../../../src/domain/fact/index.js";
import { projectWithPlan } from "../../../src/domain/reconcile/projection-plan-api.js";
import type { Projection } from "../../../src/domain/reconcile/projection-types.js";
import type { ProjectionVersions } from "../../../src/domain/reconcile/projection-versions.js";

export function projectSnapshot(
  workspaceId: string,
  snapshot: FactSnapshot,
  perspective: ProjectionPerspective,
  versions: ProjectionVersions,
): Projection {
  return projectWithPlan(workspaceId, snapshot, perspective, versions).projection;
}

export function projectionText(projection: Projection, nodeId: string): string {
  return (
    projection.nodes[nodeId]?.content
      .filter((item) => item.kind === "text")
      .map((atom) => atom.value)
      .join("") ?? ""
  );
}
