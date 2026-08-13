import type { Mutation, SequenceAnchor } from "../../domain/fact/index.js";
import type { Projection } from "../../domain/reconcile/index.js";

type MutableOccurrenceMutation = Extract<
  Mutation,
  { kind: "occurrence-move" | "occurrence-delete" }
>;

export function prepareMutableOccurrence(
  mutation: Mutation,
  previous: Projection,
  available: Projection,
): Mutation | null {
  if (mutation.kind !== "occurrence-move" && mutation.kind !== "occurrence-delete") {
    return null;
  }
  const occurrence = available.occurrences[mutation.occurrenceId];
  if (!occurrence) {
    throw new Error(`Occurrence does not exist: ${mutation.occurrenceId}`);
  }
  if (mutation.kind === "occurrence-move") {
    if (!available.nodes[mutation.parentNodeId]) {
      throw new Error("Move target parent Node is absent");
    }
    if (
      Object.values(available.occurrences).some(
        (candidate) =>
          candidate.occurrenceId !== mutation.occurrenceId &&
          candidate.nodeId === occurrence.nodeId &&
          candidate.parentNodeId === mutation.parentNodeId,
      )
    ) {
      throw new Error("A Node cannot appear twice in one parent Node children list");
    }
  }
  const evidence = previous.occurrences[mutation.occurrenceId] ? previous : available;
  return withEvidence(mutation, evidence);
}

export function prepareOccurrenceCreate(
  mutation: Extract<Mutation, { kind: "occurrence-create" }>,
  available: Projection,
): Mutation {
  if (!available.nodes[mutation.nodeId]) {
    throw new Error(`Occurrence target Node does not exist: ${mutation.nodeId}`);
  }
  assertParent(available, mutation.parentNodeId);
  const existing = available.occurrences[mutation.occurrenceId];
  if (
    existing &&
    (existing.nodeId !== mutation.nodeId || existing.parentNodeId !== mutation.parentNodeId)
  ) {
    throw new Error("Occurrence identity already names another placement");
  }
  if (
    Object.values(available.occurrences).some(
      (occurrence) =>
        occurrence.occurrenceId !== mutation.occurrenceId &&
        occurrence.nodeId === mutation.nodeId &&
        occurrence.parentNodeId === mutation.parentNodeId,
    )
  ) {
    throw new Error("A Node cannot appear twice in one parent Node children list");
  }
  return mutation;
}

export function assertParent(projection: Projection, parentNodeId: string): void {
  if (!projection.nodes[parentNodeId]) {
    throw new Error(`Parent Node does not exist: ${parentNodeId}`);
  }
}

function withEvidence(mutation: MutableOccurrenceMutation, evidence: Projection): Mutation {
  return {
    ...mutation,
    previousParentNodeId: evidence.occurrences[mutation.occurrenceId]?.parentNodeId,
    previousAnchor: anchorFor(evidence, mutation.occurrenceId),
  };
}

function anchorFor(projection: Projection, occurrenceId: string): SequenceAnchor {
  const occurrence = projection.occurrences[occurrenceId];
  const siblings = occurrence ? (projection.children[occurrence.parentNodeId] ?? []) : [];
  const index = siblings.indexOf(occurrenceId);
  return {
    after: index > 0 ? (siblings[index - 1] ?? null) : null,
    before: index >= 0 ? (siblings[index + 1] ?? null) : null,
    affinity: "after",
    fallback: index <= 0 ? "start" : "end",
  };
}
