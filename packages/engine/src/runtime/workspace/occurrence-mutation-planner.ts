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
    if (
      (mutation.parentOccurrenceId !== null &&
        !available.occurrences[mutation.parentOccurrenceId]) ||
      createsCycle(available, mutation.occurrenceId, mutation.parentOccurrenceId)
    ) {
      throw new Error("Move target is absent or would create an Occurrence storage cycle");
    }
  }
  const evidence = previous.occurrences[mutation.occurrenceId] ? previous : available;
  return withEvidence(mutation, evidence);
}

export function assertSingleRoot(projection: Projection): void {
  if ((projection.children.$root ?? []).length > 1) {
    throw new Error("Workspace already has its single root Occurrence");
  }
}

function withEvidence(mutation: MutableOccurrenceMutation, evidence: Projection): Mutation {
  return {
    ...mutation,
    previousParentOccurrenceId:
      evidence.occurrences[mutation.occurrenceId]?.parentOccurrenceId ?? null,
    previousAnchor: anchorFor(evidence, mutation.occurrenceId),
  };
}

function createsCycle(
  projection: Projection,
  occurrenceId: string,
  parentOccurrenceId: string | null,
): boolean {
  let current = parentOccurrenceId;
  const visited = new Set<string>();
  while (current !== null) {
    if (current === occurrenceId || visited.has(current)) {
      return true;
    }
    visited.add(current);
    current = projection.occurrences[current]?.parentOccurrenceId ?? null;
  }
  return false;
}

function anchorFor(projection: Projection, occurrenceId: string): SequenceAnchor {
  const occurrence = projection.occurrences[occurrenceId];
  const siblings = projection.children[occurrence?.parentOccurrenceId ?? "$root"] ?? [];
  const index = siblings.indexOf(occurrenceId);
  return {
    after: index > 0 ? (siblings[index - 1] ?? null) : null,
    before: index >= 0 ? (siblings[index + 1] ?? null) : null,
    affinity: "after",
    fallback: index <= 0 ? "start" : "end",
  };
}
