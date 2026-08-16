import type { FactSnapshot } from "../../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";
import { readFactGeneration } from "../fact-generation-reader.js";
import { readEditGeneration } from "../generation-reading/index.js";
import type { WorkspaceCommandReadPlan } from "./command-rule.js";

export function readCommandGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  snapshot: FactSnapshot,
  plan: WorkspaceCommandReadPlan,
): Promise<ScopedProjectionGeneration> {
  return plan.kind === "mutations"
    ? readEditGeneration(store, generationId, plan.mutations)
    : readFactGeneration(store, generationId, snapshot);
}
