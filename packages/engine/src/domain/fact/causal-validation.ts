import { canonicalJson } from "./canonical.js";
import { validateMaintenanceFact } from "./maintenance-causal-validation.js";
import { type Fact, type Mutation, type ResolutionFact } from "./types.js";
import { DEFAULT_FIELD_TEMPLATE_CONFIG, type FieldTemplateConfig } from "./field-template-types.js";

export function validateAdmissibleFact(
  fact: Fact,
  admitted: readonly Fact[],
  indexedMaximumObservedLamport?: number,
): void {
  let maxObservedLamport = indexedMaximumObservedLamport ?? 0;
  if (indexedMaximumObservedLamport === undefined) {
    for (const predecessor of admitted) {
      const { replicaId, sequence } = predecessor.coordinate.dot;
      if ((fact.coordinate.observed[replicaId] ?? 0) >= sequence) {
        maxObservedLamport = Math.max(maxObservedLamport, predecessor.coordinate.lamport);
      }
    }
  }
  if (fact.coordinate.lamport !== maxObservedLamport + 1) {
    throw new Error(`Invalid Fact Lamport rank: ${fact.id}`);
  }
  validateResolution(fact, admitted);
  validateFieldConfiguration(fact, admitted);
  validateFieldInitialization(fact, admitted);
  validateRestore(fact, admitted);
  validateMaintenanceFact(fact, admitted);
}

function validateFieldInitialization(fact: Fact, admitted: readonly Fact[]): void {
  if (fact.body.kind !== "contribution" || fact.body.mutation.kind !== "field-initialize") {
    return;
  }
  const mutation = fact.body.mutation;
  const observed = admitted.filter(
    (candidate) =>
      candidate.body.kind === "contribution" &&
      candidate.body.mutation.kind === "field-initialize" &&
      candidate.body.mutation.ownerNodeId === mutation.ownerNodeId &&
      candidate.body.mutation.fieldDefinitionId === mutation.fieldDefinitionId &&
      observesFact(fact, candidate),
  );
  const superseded = new Set(
    observed.flatMap((candidate) =>
      candidate.body.kind === "contribution" && candidate.body.mutation.kind === "field-initialize"
        ? (candidate.body.mutation.observedInitializationFactIds ?? [])
        : [],
    ),
  );
  const expected = observed
    .filter((candidate) => !superseded.has(candidate.id))
    .map((candidate) => candidate.id)
    .sort();
  if (
    mutation.observedInitializationFactIds === undefined ||
    canonicalJson([...mutation.observedInitializationFactIds].sort()) !== canonicalJson(expected)
  ) {
    throw new Error(`Field initialization evidence is stale: ${fact.id}`);
  }
}

function validateFieldConfiguration(fact: Fact, admitted: readonly Fact[]): void {
  if (fact.body.kind !== "contribution" || fact.body.mutation.kind !== "schema-field-configure") {
    return;
  }
  const mutation = fact.body.mutation;
  const observed = admitted.filter(
    (candidate) =>
      candidate.body.kind === "contribution" &&
      candidate.body.mutation.kind === "schema-field-configure" &&
      candidate.body.mutation.schemaId === mutation.schemaId &&
      candidate.body.mutation.fieldDefinitionId === mutation.fieldDefinitionId &&
      observesFact(fact, candidate),
  );
  const superseded = new Set(
    observed.flatMap((candidate) =>
      candidate.body.kind === "contribution" &&
      candidate.body.mutation.kind === "schema-field-configure"
        ? (candidate.body.mutation.observedConfigFactIds ?? [])
        : [],
    ),
  );
  const maximal = observed.filter((candidate) => !superseded.has(candidate.id));
  const expectedIds = maximal.map((candidate) => candidate.id).sort();
  if (
    mutation.observedConfigFactIds === undefined ||
    canonicalJson([...mutation.observedConfigFactIds].sort()) !== canonicalJson(expectedIds)
  ) {
    throw new Error(`Field config evidence does not cover observed candidates: ${fact.id}`);
  }
  const previousCandidates = new Map<string, FieldTemplateConfig>();
  for (const candidate of maximal) {
    if (candidate.body.kind === "contribution") {
      const candidateMutation = candidate.body.mutation;
      if (candidateMutation.kind === "schema-field-configure") {
        previousCandidates.set(canonicalJson(candidateMutation.config), candidateMutation.config);
      }
    }
  }
  const expectedPrevious =
    previousCandidates.size === 0
      ? DEFAULT_FIELD_TEMPLATE_CONFIG
      : previousCandidates.size === 1
        ? ([...previousCandidates.values()][0] ?? null)
        : null;
  if (canonicalJson(mutation.previousConfig) !== canonicalJson(expectedPrevious)) {
    throw new Error(`Field config previous evidence is stale: ${fact.id}`);
  }
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
    const observedResolutions = admitted.filter(
      (candidate) =>
        candidate.body.kind === "resolution" &&
        candidate.body.proposalContributionIds.includes(targetId) &&
        observesFact(fact, candidate),
    );
    if (fact.body.adjudicatesResolutionIds.length === 0 && observedResolutions.length > 0) {
      throw new Error(`Proposal Contribution is already terminal: ${targetId}`);
    }
  }
  validateAdjudication(fact, admitted);
}

function validateAdjudication(fact: Fact, admitted: readonly Fact[]): void {
  if (fact.body.kind !== "resolution" || fact.body.adjudicatesResolutionIds.length === 0) {
    return;
  }
  const adjudicated = fact.body.adjudicatesResolutionIds.map((resolutionId): ResolutionFact => {
    const resolution = admitted.find((candidate) => candidate.id === resolutionId);
    if (resolution?.body.kind !== "resolution" || !observesFact(fact, resolution)) {
      throw new Error(`Adjudication target is not an observed Resolution: ${resolutionId}`);
    }
    return resolution as ResolutionFact;
  });
  const targetIds = [...fact.body.proposalContributionIds].sort();
  if (
    adjudicated.some(
      (resolution) =>
        JSON.stringify([...resolution.body.proposalContributionIds].sort()) !==
        JSON.stringify(targetIds),
    ) ||
    new Set(adjudicated.map((resolution) => resolution.body.decision)).size < 2
  ) {
    throw new Error(`Adjudication does not resolve one opposite Resolution conflict: ${fact.id}`);
  }
  const current = maximalResolutionIds(admitted, targetIds);
  if (JSON.stringify([...fact.body.adjudicatesResolutionIds].sort()) !== JSON.stringify(current)) {
    throw new Error(`Adjudication does not cover the current Resolution conflict: ${fact.id}`);
  }
}

function maximalResolutionIds(admitted: readonly Fact[], targetIds: readonly string[]): string[] {
  const resolutions = admitted.filter(
    (candidate) =>
      candidate.body.kind === "resolution" &&
      JSON.stringify([...candidate.body.proposalContributionIds].sort()) ===
        JSON.stringify(targetIds),
  );
  const superseded = new Set(
    resolutions.flatMap((resolution) =>
      resolution.body.kind === "resolution" ? resolution.body.adjudicatesResolutionIds : [],
    ),
  );
  return resolutions
    .filter((resolution) => !superseded.has(resolution.id))
    .map((resolution) => resolution.id)
    .sort();
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
      occurrenceDeletionIdentity(deleted) === mutation.occurrenceId);
  if (!matches) {
    throw new Error(`Restore deletion target mismatch: ${fact.id}`);
  }
}

function occurrenceDeletionIdentity(mutation: Mutation): string | null {
  if (mutation.kind === "occurrence-delete") {
    return mutation.occurrenceId;
  }
  if (mutation.kind === "field-value-delete") {
    return mutation.valueOccurrenceId;
  }
  return mutation.kind === "materialized-field-delete" ? mutation.fieldOccurrenceId : null;
}

function observesFact(observer: Fact, observed: Fact): boolean {
  return (
    (observer.coordinate.observed[observed.coordinate.dot.replicaId] ?? 0) >=
    observed.coordinate.dot.sequence
  );
}
