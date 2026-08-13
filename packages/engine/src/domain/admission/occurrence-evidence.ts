import { canonicalJson, type Mutation, type SequenceAnchor } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateOccurrenceCreate(
  mutation: Extract<Mutation, { kind: "occurrence-create" }>,
  available: Projection,
): void {
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
}

export function validateOccurrenceEvidence(
  mutation: Extract<Mutation, { kind: "occurrence-move" | "occurrence-delete" }>,
  previous: Projection,
  available: Projection,
): void {
  const occurrence = available.occurrences[mutation.occurrenceId];
  if (!occurrence) {
    throw new Error("Occurrence target is absent from the observed projection");
  }
  const prior = previous.occurrences[mutation.occurrenceId] ?? occurrence;
  if (mutation.kind === "occurrence-move") {
    assertOccurrenceParent(available, mutation.parentNodeId);
    assertUniquePlacement(
      available,
      occurrence.nodeId,
      mutation.parentNodeId,
      mutation.occurrenceId,
    );
  }
  assertSame(
    prior.parentNodeId,
    mutation.previousParentNodeId,
    "Occurrence previous parent evidence",
  );
  assertSame(
    anchorFor(
      previous.occurrences[mutation.occurrenceId] ? previous : available,
      mutation.occurrenceId,
    ),
    mutation.previousAnchor,
    "Occurrence previous anchor evidence",
  );
}

export function assertOccurrenceParent(projection: Projection, parentNodeId: string): void {
  if (!projection.nodes[parentNodeId]) {
    throw new Error("Parent Node is absent from the observed projection");
  }
}

function assertUniquePlacement(
  projection: Projection,
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

function assertSame(expected: unknown, actual: unknown, label: string): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`${label} does not match the observed projection`);
  }
}
