import type { FactSnapshot } from "../../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../projection/index.js";
import { readFactGeneration } from "../fact-generation-reader.js";
import { readEditGeneration } from "../generation-reading/index.js";
import type { WorkspaceCommandReadPlan } from "./command-rule.js";

export function readCommandGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  snapshot: FactSnapshot,
  plan: WorkspaceCommandReadPlan,
): Promise<ScopedProjectionGeneration> {
  return plan.kind === "edits"
    ? readEditGeneration(store, generationId, plan.actions)
    : readFactGeneration(store, generationId, snapshot);
}
