import { factActionsFromFacts, type FactSnapshot } from "../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "./projection/index.js";
import { readFactActionGeneration } from "./generation-reading/index.js";

export function readFactGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  snapshot: FactSnapshot,
): Promise<ScopedProjectionGeneration> {
  return readFactActionGeneration(store, generationId, factActionsFromFacts(snapshot.facts));
}
