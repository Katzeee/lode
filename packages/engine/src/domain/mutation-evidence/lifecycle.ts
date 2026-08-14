import { occurrenceRestoreDeletionId, type FactSnapshot } from "../fact/index.js";

export function assertObservedDeletion(
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
      : occurrenceRestoreDeletionId(mutation) === identity;
  if (!matches) {
    throw new Error(`Restore does not reference an observed ${kind} Fact`);
  }
}
