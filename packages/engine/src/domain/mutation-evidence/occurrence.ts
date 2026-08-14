import type { Mutation } from "../fact/index.js";
import { occurrenceAnchor, type ScopedProjection } from "../reconcile/index.js";

type MutableOccurrenceMutation = Extract<
  Mutation,
  { kind: "occurrence-move" | "occurrence-delete" }
>;

export function completeOccurrenceCreate(
  mutation: Extract<Mutation, { kind: "occurrence-create" }>,
  available: ScopedProjection,
): Mutation {
  if (!available.nodes[mutation.nodeId]) {
    throw new Error("Occurrence Node is absent from the observed projection");
  }
  assertOccurrenceParent(available, mutation.parentNodeId);
  const existing = available.occurrences[mutation.occurrenceId];
  if (
    existing &&
    (existing.nodeId !== mutation.nodeId || existing.parentNodeId !== mutation.parentNodeId)
  ) {
    throw new Error("Occurrence identity already names another placement");
  }
  assertUniquePlacement(available, mutation.nodeId, mutation.parentNodeId, mutation.occurrenceId);
  return mutation;
}

export function completeMutableOccurrenceEvidence(
  mutation: Mutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): MutableOccurrenceMutation | null {
  if (mutation.kind !== "occurrence-move" && mutation.kind !== "occurrence-delete") {
    return null;
  }
  const occurrence = available.occurrences[mutation.occurrenceId];
  if (!occurrence) {
    throw new Error("Occurrence target is absent from the observed projection");
  }
  if (mutation.kind === "occurrence-move") {
    assertOccurrenceParent(available, mutation.parentNodeId);
    assertUniquePlacement(
      available,
      occurrence.nodeId,
      mutation.parentNodeId,
      mutation.occurrenceId,
    );
  }
  const evidence = previous.occurrences[mutation.occurrenceId] ? previous : available;
  return {
    ...mutation,
    previousParentNodeId: evidence.occurrences[mutation.occurrenceId]?.parentNodeId,
    previousAnchor: occurrenceAnchor(evidence, mutation.occurrenceId),
  };
}

export function assertOccurrenceParent(projection: ScopedProjection, parentNodeId: string): void {
  if (!projection.nodes[parentNodeId]) {
    throw new Error("Parent Node is absent from the observed projection");
  }
}

function assertUniquePlacement(
  projection: ScopedProjection,
  nodeId: string,
  parentNodeId: string,
  excludedOccurrenceId?: string,
): void {
  if (
    Object.values(projection.occurrences).some(
      (occurrence) =>
        occurrence.occurrenceId !== excludedOccurrenceId &&
        occurrence.nodeId === nodeId &&
        occurrence.parentNodeId === parentNodeId,
    )
  ) {
    throw new Error("A Node cannot appear twice in one parent Node children list");
  }
}
