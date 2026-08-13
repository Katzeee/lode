import { canonicalDigest, canonicalJson } from "./canonical.js";
import { factId, factTransactionId, isReplicaId, unsignedFact } from "./fact.js";
import { validateFieldInitialization, validateSchemaMutation } from "./schema-static-validation.js";
import { isWellFormedUnicode } from "./text-validation.js";
import { validateTemplateDetachment } from "./template-node-validation.js";
import { validateWorkspaceRootPolicy } from "./workspace-root-policy.js";
import {
  validateStaticFieldContentDeletion,
  validateStaticFieldMaterialization,
} from "./field-content-validation.js";
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
  const transaction = fact.transaction;
  if (
    !Number.isSafeInteger(transaction.index) ||
    transaction.index < 0 ||
    !Number.isSafeInteger(transaction.size) ||
    transaction.size < 1 ||
    transaction.index >= transaction.size
  ) {
    throw new Error(`Invalid Fact transaction position: ${fact.id}`);
  }
  const firstSequence = sequence - transaction.index;
  if (
    firstSequence < 1 ||
    transaction.transactionId !== factTransactionId(workspaceId, replicaId, firstSequence)
  ) {
    throw new Error(`Fact transaction identity does not match its position: ${fact.id}`);
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
  validateWorkspaceRootPolicy(workspaceId, fact);
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
      new Set(body.proposalContributionIds).size !== body.proposalContributionIds.length ||
      new Set(body.adjudicatesResolutionIds).size !== body.adjudicatesResolutionIds.length
    ) {
      throw new Error(`Resolution target set is empty or duplicated: ${id}`);
    }
    return;
  }
  if (body.kind === "maintenance") {
    validateMaintenanceAction(body.action, id);
    return;
  }
  if (body.intent !== "direct" && body.intent !== "proposal") {
    throw new Error(`Invalid Contribution intent: ${id}`);
  }
  validateMutation(body.mutation, id);
}

function validateMaintenanceAction(
  action: Extract<FactBody, { kind: "maintenance" }>["action"],
  id: string,
): void {
  if (action.kind === "replica-retire") {
    if (!isReplicaId(action.replicaId)) {
      throw new Error(`Invalid retired Replica identity: ${id}`);
    }
    return;
  }
  requireIdentity(action.nodeId, "Maintenance Node", id);
  const identities =
    action.kind === "node-purge"
      ? [...action.deletionFactIds, ...action.acknowledgementFactIds, ...action.retiredReplicaIds]
      : action.deletionFactIds;
  if (identities.length === 0 || new Set(identities).size !== identities.length) {
    throw new Error(`Maintenance evidence is empty or duplicated: ${id}`);
  }
  if (
    action.kind === "node-purge" &&
    action.retiredReplicaIds.some((replicaId) => !isReplicaId(replicaId))
  ) {
    throw new Error(`Invalid retired Replica evidence: ${id}`);
  }
}

function validateMutation(mutation: Mutation, factIdentity: string): void {
  switch (mutation.kind) {
    case "node-create":
      validateNodeCreation(mutation, factIdentity);
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
    case "node-owner-set":
      requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
      requireIdentity(mutation.ownerNodeId, mutation.kind, factIdentity);
      if (mutation.previousOwnerNodeId === undefined) {
        throw new Error(`Node owner mutation lacks semantic evidence: ${factIdentity}`);
      }
      requireIdentity(mutation.previousOwnerNodeId, "previous owner Node", factIdentity);
      return;
    case "schema-apply":
    case "schema-remove":
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
    case "schema-template-node-add":
    case "schema-template-node-remove":
      validateSchemaMutation(mutation, factIdentity);
      return;
    case "template-node-detach":
      validateTemplateDetachment(mutation, factIdentity);
      return;
    case "field-materialize":
      validateStaticFieldMaterialization(mutation, factIdentity);
      return;
    case "field-value-delete":
    case "materialized-field-delete":
      validateStaticFieldContentDeletion(mutation, factIdentity);
      return;
    case "field-initialize":
      validateFieldInitialization(mutation, factIdentity);
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
      requireIdentity(mutation.target.id, `${mutation.target.kind} owner`, factIdentity);
      requireIdentity(mutation.key, "value key", factIdentity);
      if (mutation.previous === undefined) {
        throw new Error(`Value mutation lacks semantic evidence: ${factIdentity}`);
      }
  }
}

function validateNodeCreation(
  mutation: Extract<Mutation, { kind: "node-create" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.nodeId, "node-create", factIdentity);
  if (mutation.seed?.text.some((atom) => !isWellFormedUnicode(atom.value))) {
    throw new Error(`Node seed contains an unpaired surrogate: ${factIdentity}`);
  }
}

function validateOccurrenceMutation(
  mutation: Extract<Mutation, { kind: `occurrence-${string}` }>,
  factIdentity: string,
): void {
  if (mutation.kind === "occurrence-restore") {
    requireIdentity(mutation.occurrenceId, mutation.kind, factIdentity);
    requireIdentity(mutation.deletionFactId, "deletion Fact", factIdentity);
    requireIdentity(mutation.parentNodeId, "parent Node", factIdentity);
    validateRestorationAnchor(mutation.anchor, factIdentity);
    return;
  }
  requireIdentity(mutation.occurrenceId, mutation.kind, factIdentity);
  if (mutation.kind === "occurrence-create") {
    requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
    requireIdentity(mutation.parentNodeId, "parent Node", factIdentity);
    validateAnchor(mutation.anchor, factIdentity);
    return;
  }
  if (mutation.kind === "occurrence-delete") {
    if (mutation.previousParentNodeId === undefined || mutation.previousAnchor === undefined) {
      throw new Error(`Occurrence deletion lacks semantic evidence: ${factIdentity}`);
    }
    requireIdentity(mutation.previousParentNodeId, "previous parent Node", factIdentity);
    validateAnchor(mutation.previousAnchor, factIdentity);
    return;
  }
  requireIdentity(mutation.parentNodeId, "parent Node", factIdentity);
  validateAnchor(mutation.anchor, factIdentity);
  if (mutation.previousParentNodeId === undefined || mutation.previousAnchor === undefined) {
    throw new Error(`Occurrence move lacks semantic evidence: ${factIdentity}`);
  }
  requireIdentity(mutation.previousParentNodeId, "previous parent Node", factIdentity);
  validateAnchor(mutation.previousAnchor, factIdentity);
}

function validateRestorationAnchor(anchor: SequenceAnchor, factIdentity: string): void {
  if (anchor.after !== null && anchor.before !== null && anchor.after === anchor.before) {
    throw new Error(`Sequence anchor repeats one identity: ${factIdentity}`);
  }
  requireNullableIdentity(anchor.after, "anchor endpoint", factIdentity);
  requireNullableIdentity(anchor.before, "anchor endpoint", factIdentity);
}

function validateAnchor(anchor: SequenceAnchor, factIdentity: string): void {
  if (anchor.after !== null && anchor.before !== null && anchor.after === anchor.before) {
    throw new Error(`Sequence anchor repeats one identity: ${factIdentity}`);
  }
  requireNullableIdentity(anchor.after, "anchor endpoint", factIdentity);
  requireNullableIdentity(anchor.before, "anchor endpoint", factIdentity);
}

function requireIdentity(value: string, label: string, factIdentity: string): void {
  if (value.length === 0) {
    throw new Error(`${label} identity is empty: ${factIdentity}`);
  }
}

function requireNullableIdentity(value: string | null, label: string, factIdentity: string): void {
  if (value !== null) {
    requireIdentity(value, label, factIdentity);
  }
}
