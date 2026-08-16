import type { FactSnapshot } from "../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../materialization/index.js";
import { readMutationGeneration } from "./generation-reading/index.js";

export function readFactGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  snapshot: FactSnapshot,
): Promise<ScopedProjectionGeneration> {
  return readMutationGeneration(
    store,
    generationId,
    snapshot.facts.flatMap((fact) => (fact.body.kind === "contribution" ? [fact.body.mutation] : [])),
  );
}
