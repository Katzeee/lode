import { compareFacts, type ContributionFact } from "../fact/index.js";

export function hasAlternateNodeCreator(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
): boolean {
  const mutation = target.body.mutation;
  if (mutation.kind !== "node-create" && mutation.kind !== "node-restore") {
    return false;
  }
  return activeFacts.some((fact) => {
    if (targetIds.has(fact.id)) {
      return false;
    }
    const candidate = fact.body.mutation;
    return mutation.kind === "node-create"
      ? candidate.kind === "node-create" && candidate.nodeId === mutation.nodeId
      : candidate.kind === "node-restore" &&
          candidate.nodeId === mutation.nodeId &&
          candidate.deletionFactId === mutation.deletionFactId;
  });
}

export function hasIndependentOccurrenceWork(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
): boolean {
  const mutation = target.body.mutation;
  if (mutation.kind !== "occurrence-create" && mutation.kind !== "occurrence-restore") {
    return false;
  }
  return activeFacts.some((fact) => {
    if (targetIds.has(fact.id)) {
      return false;
    }
    const candidate = fact.body.mutation;
    const alternateCreator =
      mutation.kind === "occurrence-create"
        ? candidate.kind === "occurrence-create" && candidate.occurrenceId === mutation.occurrenceId
        : candidate.kind === "occurrence-restore" &&
          candidate.occurrenceId === mutation.occurrenceId &&
          candidate.deletionFactId === mutation.deletionFactId;
    if (alternateCreator) {
      return true;
    }
    if (compareFacts(target, fact) >= 0) {
      return false;
    }
    return (
      ("occurrenceId" in candidate && candidate.occurrenceId === mutation.occurrenceId) ||
      ((candidate.kind === "value-set" || candidate.kind === "value-unset") &&
        candidate.target.kind === "occurrence" &&
        candidate.target.id === mutation.occurrenceId) ||
      candidate.kind === "node-owner-set"
    );
  });
}
