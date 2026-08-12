import type { FactSnapshot, Mutation } from "../fact/index.js";

export function assertDeletion(
  snapshot: FactSnapshot,
  deletionFactId: string,
  kind: "node-delete" | "occurrence-delete",
  identity: string,
): void {
  const deletion = snapshot.facts.find((fact) => fact.id === deletionFactId);
  const mutation = deletion?.body.kind === "contribution" ? deletion.body.mutation : null;
  const matches =
    kind === "node-delete"
      ? mutation?.kind === kind && mutation.nodeId === identity
      : occurrenceDeletionIdentity(mutation) === identity;
  if (!matches) {
    throw new Error(`Restore does not reference an observed ${kind} Fact`);
  }
}

function occurrenceDeletionIdentity(mutation: Mutation | null): string | null {
  if (mutation?.kind === "occurrence-delete") {
    return mutation.occurrenceId;
  }
  if (mutation?.kind === "field-value-delete") {
    return mutation.valueOccurrenceId;
  }
  return mutation?.kind === "materialized-field-delete" ? mutation.fieldOccurrenceId : null;
}
