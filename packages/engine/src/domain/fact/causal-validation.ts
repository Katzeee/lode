import type { Fact } from "./types.js";

export function validateAdmissibleFact(fact: Fact, admitted: readonly Fact[]): void {
  let maxObservedLamport = 0;
  for (const predecessor of admitted) {
    const { replicaId, sequence } = predecessor.coordinate.dot;
    if ((fact.coordinate.observed[replicaId] ?? 0) >= sequence) {
      maxObservedLamport = Math.max(maxObservedLamport, predecessor.coordinate.lamport);
    }
  }
  if (fact.coordinate.lamport !== maxObservedLamport + 1) {
    throw new Error(`Invalid Fact Lamport rank: ${fact.id}`);
  }
  validateResolution(fact, admitted);
  validateRestore(fact, admitted);
}

function validateResolution(fact: Fact, admitted: readonly Fact[]): void {
  if (fact.body.kind !== "resolution") {
    return;
  }
  for (const targetId of fact.body.proposalContributionIds) {
    const target = admitted.find((candidate) => candidate.id === targetId);
    if (!target || target.body.kind !== "contribution" || target.body.intent !== "proposal") {
      throw new Error(`Resolution target is not an observed Proposal Contribution: ${targetId}`);
    }
    if (!observesFact(fact, target)) {
      throw new Error(`Resolution does not causally observe Proposal Contribution: ${targetId}`);
    }
    const observedResolution = admitted.some(
      (candidate) =>
        candidate.body.kind === "resolution" &&
        candidate.body.proposalContributionIds.includes(targetId) &&
        observesFact(fact, candidate),
    );
    if (observedResolution) {
      throw new Error(`Proposal Contribution is already terminal: ${targetId}`);
    }
  }
}

function validateRestore(fact: Fact, admitted: readonly Fact[]): void {
  if (fact.body.kind !== "contribution") {
    return;
  }
  const mutation = fact.body.mutation;
  if (mutation.kind !== "node-restore" && mutation.kind !== "occurrence-restore") {
    return;
  }
  const deletion = admitted.find((candidate) => candidate.id === mutation.deletionFactId);
  if (!deletion || deletion.body.kind !== "contribution") {
    throw new Error(`Restore does not reference an observed deletion: ${fact.id}`);
  }
  if (!observesFact(fact, deletion)) {
    throw new Error(`Restore does not causally observe its deletion: ${fact.id}`);
  }
  const deleted = deletion.body.mutation;
  const matches =
    (mutation.kind === "node-restore" &&
      deleted.kind === "node-delete" &&
      deleted.nodeId === mutation.nodeId) ||
    (mutation.kind === "occurrence-restore" &&
      deleted.kind === "occurrence-delete" &&
      deleted.occurrenceId === mutation.occurrenceId);
  if (!matches) {
    throw new Error(`Restore deletion target mismatch: ${fact.id}`);
  }
}

function observesFact(observer: Fact, observed: Fact): boolean {
  return (
    (observer.coordinate.observed[observed.coordinate.dot.replicaId] ?? 0) >=
    observed.coordinate.dot.sequence
  );
}
