import type { FactSnapshot } from "../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../materialization/index.js";
import { readMutationGeneration } from "./generation-reading/index.js";

export function readFactGeneration(
  store: ProjectionSnapshotReader,
  generationId: string,
  snapshot: FactSnapshot,
  factIds: readonly string[],
): Promise<ScopedProjectionGeneration> {
  const selected = new Set(factIds);
  return readMutationGeneration(
    store,
    generationId,
    snapshot.facts.flatMap((fact) =>
      selected.has(fact.id) && fact.body.kind === "contribution" ? [fact.body.mutation] : [],
    ),
  );
}
