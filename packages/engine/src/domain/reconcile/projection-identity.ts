import { canonicalDigest, type FactSnapshot, type ProjectionIdentity } from "../fact/index.js";
import type { ProjectionVersions } from "./projection-types.js";

export function projectionIdentity(
  workspaceId: string,
  snapshot: FactSnapshot,
  versions: ProjectionVersions,
): ProjectionIdentity {
  return {
    generationId: canonicalDigest({
      workspaceId,
      frontier: snapshot.frontier,
      rulesVersion: versions.rulesVersion,
      schemaVersion: versions.schemaVersion,
    }),
    frontier: snapshot.frontier,
    rulesVersion: versions.rulesVersion,
    schemaVersion: versions.schemaVersion,
  };
}
