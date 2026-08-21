import type { FactSnapshot, Mutation } from "../../../domain/fact/index.js";
import { completeMutationEvidence } from "../../../domain/mutation-evidence/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

export function prepareMutation(
  mutation: Mutation,
  previous: ScopedProjection,
  available: ScopedProjection,
  snapshot: FactSnapshot,
): Mutation {
  const prepared = completeMutationEvidence(mutation, {
    snapshot,
    projections: () => ({ previous, available }),
  });
  if (prepared.kind === "intrinsic-node-type-declare") {
    const current = available.nodes[prepared.nodeId]?.intrinsicNodeType ?? null;
    if (current === prepared.intrinsicNodeType) {
      throw new Error("Node already has the requested type");
    }
  }
  return prepared;
}
