import type { FactSnapshot } from "../../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../projection/index.js";
import { readFactGeneration } from "../fact-generation-reader.js";
import { readEditGeneration, readProjectionScopeGeneration } from "../generation-reading/index.js";
import type { WorkspaceCommandReadPlan } from "./command-rule.js";

export function readCommandGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  snapshot: FactSnapshot,
  plan: WorkspaceCommandReadPlan,
): Promise<ScopedProjectionGeneration> {
  if (plan.kind === "edits") {
    return readEditGeneration(store, generationId, plan.actions);
  }
  if (plan.kind === "projection-scope") {
    return readProjectionScopeGeneration(
      store,
      generationId,
      plan.nodeIds,
      plan.readsOwnerGraph,
      plan.readsOwnedDescendants,
    );
  }
  return readFactGeneration(store, generationId, snapshot);
}
