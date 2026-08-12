import { canonicalDigest, canonicalJson } from "./canonical.js";
import { factId, isReplicaId, unsignedFact } from "./fact.js";
import { isReservedNodeIdentity, isReservedOccurrenceIdentity } from "./identity.js";
import { isWellFormedUnicode } from "./text-validation.js";
import {
  FACT_SCHEMA_VERSION,
  FORMAT_GENERATION,
  type Fact,
  type FactBody,
  type Mutation,
  type SequenceAnchor,
  type WorkspaceId,
} from "./types.js";

export function validateStaticFact(workspaceId: WorkspaceId, fact: Fact): void {
  if (fact.workspaceId !== workspaceId) {
    throw new Error(`Fact workspace mismatch: ${fact.id}`);
  }
  if (fact.formatGeneration !== FORMAT_GENERATION || fact.schemaVersion !== FACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported Fact version: ${fact.id}`);
  }
  const { replicaId, sequence } = fact.coordinate.dot;
  if (!isReplicaId(replicaId) || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`Invalid Fact coordinate: ${fact.id}`);
  }
  if (fact.id !== factId(workspaceId, replicaId, sequence)) {
    throw new Error(`FactId/dot mismatch: ${fact.id}`);
  }
  if (!Number.isSafeInteger(fact.coordinate.lamport) || fact.coordinate.lamport < 1) {
    throw new Error(`Invalid Fact Lamport rank: ${fact.id}`);
  }
  for (const [observedReplicaId, observedSequence] of Object.entries(fact.coordinate.observed)) {
    if (
      !isReplicaId(observedReplicaId) ||
      !Number.isSafeInteger(observedSequence) ||
      observedSequence < 0
    ) {
      throw new Error(`Invalid observed frontier: ${fact.id}`);
    }
    if (observedReplicaId === replicaId && observedSequence >= sequence) {
      throw new Error(`Fact observes itself or its future: ${fact.id}`);
    }
  }
  if ((fact.coordinate.observed[replicaId] ?? 0) !== sequence - 1) {
    throw new Error(`Fact does not observe its Replica predecessor: ${fact.id}`);
  }
  if (canonicalDigest(unsignedFact(fact)) !== fact.contentDigest) {
    throw new Error(`Fact digest mismatch: ${fact.id}`);
  }
  validateBody(fact.body, fact.id);
}

function validateBody(body: FactBody, id: string): void {
  if (!body.actorId) {
    throw new Error(`Fact actor is empty: ${id}`);
  }
  if (body.kind === "resolution") {
    if (body.decision !== "accept" && body.decision !== "reject") {
      throw new Error(`Invalid Resolution decision: ${id}`);
    }
    if (
      body.proposalContributionIds.length === 0 ||
      new Set(body.proposalContributionIds).size !== body.proposalContributionIds.length
    ) {
      throw new Error(`Resolution target set is empty or duplicated: ${id}`);
    }
    return;
  }
  if (body.intent !== "direct" && body.intent !== "proposal") {
    throw new Error(`Invalid Contribution intent: ${id}`);
  }
  validateMutation(body.mutation, id);
}

function validateMutation(mutation: Mutation, factIdentity: string): void {
  switch (mutation.kind) {
    case "node-create":
      requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
      if (isReservedNodeIdentity(mutation.nodeId)) {
        throw new Error(`Node uses a reserved managed identity: ${factIdentity}`);
      }
      return;
    case "node-delete":
      requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
      return;
    case "node-restore":
      requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
      requireIdentity(mutation.deletionFactId, "deletion Fact", factIdentity);
      return;
    case "occurrence-create":
    case "occurrence-delete":
    case "occurrence-restore":
    case "occurrence-move":
      validateOccurrenceMutation(mutation, factIdentity);
      return;
    case "canonical-occurrence-set":
      requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
      requireOccurrenceIdentity(mutation.occurrenceId, mutation.kind, factIdentity);
      if (mutation.previousOccurrenceId === undefined) {
        throw new Error(`Canonical mutation lacks semantic evidence: ${factIdentity}`);
      }
      requireNullableOccurrenceIdentity(
        mutation.previousOccurrenceId,
        "previous canonical",
        factIdentity,
      );
      return;
    case "text-splice":
      requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
      validateAnchor(mutation.anchor, factIdentity);
      if (!isWellFormedUnicode(mutation.insert)) {
        throw new Error(`Text mutation contains an unpaired surrogate: ${factIdentity}`);
      }
      if (mutation.deletedAtoms === undefined) {
        throw new Error(`Text splice lacks semantic evidence: ${factIdentity}`);
      }
      if (
        new Set(mutation.deleteAtomIds).size !== mutation.deleteAtomIds.length ||
        new Set(mutation.deletedAtoms.map((atom) => atom.id)).size !==
          mutation.deletedAtoms.length ||
        canonicalJson([...mutation.deleteAtomIds].sort()) !==
          canonicalJson(mutation.deletedAtoms.map((atom) => atom.id).sort())
      ) {
        throw new Error(`Text splice deletion evidence does not match targets: ${factIdentity}`);
      }
      return;
    case "text-mark":
      requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
      requireIdentity(mutation.key, "mark key", factIdentity);
      if (mutation.previous === undefined) {
        throw new Error(`Text mark lacks semantic evidence: ${factIdentity}`);
      }
      if (
        mutation.atomIds.length === 0 ||
        new Set(mutation.atomIds).size !== mutation.atomIds.length
      ) {
        throw new Error(`Text mark targets are empty or duplicated: ${factIdentity}`);
      }
      return;
    case "value-set":
    case "value-unset":
      requireIdentity(mutation.owner.id, `${mutation.owner.kind} owner`, factIdentity);
      requireIdentity(mutation.key, "value key", factIdentity);
      if (mutation.previous === undefined) {
        throw new Error(`Value mutation lacks semantic evidence: ${factIdentity}`);
      }
  }
}

function validateOccurrenceMutation(
  mutation: Extract<Mutation, { kind: `occurrence-${string}` }>,
  factIdentity: string,
): void {
  requireOccurrenceIdentity(mutation.occurrenceId, mutation.kind, factIdentity);
  if (mutation.kind === "occurrence-create") {
    requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
    requireNullableOccurrenceIdentity(mutation.parentOccurrenceId, "parent", factIdentity);
    validateAnchor(mutation.anchor, factIdentity);
    return;
  }
  if (mutation.kind === "occurrence-delete") {
    if (
      mutation.previousParentOccurrenceId === undefined ||
      mutation.previousAnchor === undefined
    ) {
      throw new Error(`Occurrence deletion lacks semantic evidence: ${factIdentity}`);
    }
    requireNullableOccurrenceIdentity(
      mutation.previousParentOccurrenceId,
      "previous parent",
      factIdentity,
    );
    validateAnchor(mutation.previousAnchor, factIdentity);
    return;
  }
  if (mutation.kind === "occurrence-restore") {
    requireIdentity(mutation.deletionFactId, "deletion Fact", factIdentity);
    requireNullableOccurrenceIdentity(mutation.parentOccurrenceId, "parent", factIdentity);
    validateAnchor(mutation.anchor, factIdentity);
    return;
  }
  requireNullableOccurrenceIdentity(mutation.parentOccurrenceId, "parent", factIdentity);
  validateAnchor(mutation.anchor, factIdentity);
  if (mutation.previousParentOccurrenceId === undefined || mutation.previousAnchor === undefined) {
    throw new Error(`Occurrence move lacks semantic evidence: ${factIdentity}`);
  }
  requireNullableOccurrenceIdentity(
    mutation.previousParentOccurrenceId,
    "previous parent",
    factIdentity,
  );
  validateAnchor(mutation.previousAnchor, factIdentity);
}

function validateAnchor(anchor: SequenceAnchor, factIdentity: string): void {
  if (anchor.after !== null && anchor.before !== null && anchor.after === anchor.before) {
    throw new Error(`Sequence anchor repeats one identity: ${factIdentity}`);
  }
  requireNullableOccurrenceIdentity(anchor.after, "anchor endpoint", factIdentity);
  requireNullableOccurrenceIdentity(anchor.before, "anchor endpoint", factIdentity);
}

function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}

function requireOccurrenceIdentity(value: string, label: string, factIdentity: string): void {
  requireIdentity(value, label, factIdentity);
  if (isReservedOccurrenceIdentity(value)) {
    throw new Error(`${label} uses a reserved Occurrence identity: ${factIdentity}`);
  }
}

function requireNullableOccurrenceIdentity(
  value: string | null,
  label: string,
  factIdentity: string,
): void {
  if (value !== null) {
    requireOccurrenceIdentity(value, label, factIdentity);
  }
}
