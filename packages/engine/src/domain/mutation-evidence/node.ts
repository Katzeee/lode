import type { Mutation } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";

export function completeNodeOwnerEvidence(
  mutation: Extract<Mutation, { kind: "node-owner-set" }>,
  previous: ScopedProjection,
  available: ScopedProjection,
): Extract<Mutation, { kind: "node-owner-set" }> {
  if (
    !available.nodes[mutation.ownerNodeId] ||
    !Object.values(available.occurrences).some(
      (occurrence) =>
        occurrence.nodeId === mutation.nodeId && occurrence.parentNodeId === mutation.ownerNodeId,
    )
  ) {
    throw new Error("Owner target is absent from the observed projection");
  }
  assertOwnerAcyclic(mutation.nodeId, mutation.ownerNodeId, previous);
  const previousOwnerNodeId = previous.nodeOwners[mutation.nodeId];
  if (!previousOwnerNodeId) {
    throw new Error("Workspace Node ownership cannot change");
  }
  return { ...mutation, previousOwnerNodeId };
}

export function assertNodeTypeCompatible(
  mutation: Extract<Mutation, { kind: "node-type-declare" }>,
  available: ScopedProjection,
): void {
  if (!available.nodes[mutation.nodeId]) {
    throw new Error("Node type target is absent from the observed projection");
  }
  const current = available.nodeStatuses[mutation.nodeId]?.nodeType ?? null;
  if (current !== null && current !== mutation.nodeType) {
    throw new Error("A Node cannot declare another type");
  }
}

export function assertNodeDeletionTarget(
  mutation: Extract<Mutation, { kind: "node-delete" }>,
  available: ScopedProjection,
): void {
  if (!available.nodes[mutation.nodeId]) {
    throw new Error(`Delete target Node does not exist: ${mutation.nodeId}`);
  }
}

function assertOwnerAcyclic(
  nodeId: string,
  ownerNodeId: string,
  projection: ScopedProjection,
): void {
  let cursor: string | null | undefined = ownerNodeId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined) {
    if (cursor === nodeId || seen.has(cursor)) {
      throw new Error("Node ownership would form a cycle");
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
}
