import type { ContributionFact } from "../fact/index.js";

export function occurrenceDeletionIds(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "occurrence-delete") {
      const ids = result.get(mutation.occurrenceId) ?? [];
      ids.push(fact.id);
      result.set(mutation.occurrenceId, ids);
    }
  }
  return result;
}

export function hasUnrestoredDeletion(
  occurrenceId: string,
  deletionIds: ReadonlyMap<string, readonly string[]>,
  restoredDeletionIds: ReadonlySet<string>,
): boolean {
  return (deletionIds.get(occurrenceId) ?? []).some(
    (deletionId) => !restoredDeletionIds.has(deletionId),
  );
}
