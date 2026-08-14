import type { FactSnapshot } from "../../../domain/fact/index.js";
import {
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../../domain/reconcile/index.js";
import type { ProjectionCheckpointStore } from "../../materialization/index.js";

export async function initialProjectionGeneration(
  workspaceId: string,
  snapshot: FactSnapshot,
  versions: ProjectionVersions,
  checkpoints?: ProjectionCheckpointStore,
): Promise<ProjectionGeneration> {
  const checkpoint = await checkpoints?.load(snapshot, versions);
  return checkpoint?.kind === "valid"
    ? checkpoint.generation
    : rebuildGeneration(workspaceId, snapshot, versions).generation;
}
