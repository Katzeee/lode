import { canonicalDigest } from "./canonical.js";
import { factId, factTransactionId, isReplicaId, unsignedFact } from "./fact.js";
import { validateSupertagMutation } from "./supertag-static-validation.js";
import { isWellFormedUnicode, validateStaticTextSpliceEvidence } from "./text-validation.js";
import { validateTemplateDetachment } from "./template-node-validation.js";
import { validateWorkspaceRootPolicy } from "./workspace-root-policy.js";
import { validateStaticFieldContentDeletion, validateStaticFieldMaterialization } from "./field-content-validation.js";
import {
  FACT_SCHEMA_VERSION,
  FORMAT_GENERATION,
  type Fact,
  type FactBody,
  type Mutation,
  type SequenceAnchor,
  type WorkspaceId,
} from "./types.js";
import type { OccurrenceMutation } from "./mutation-family.js";
import { validateSearchExpressionMutation } from "./search-expression-validation.js";
import { validateViewMutation } from "./view-static-validation.js";
import { validateInlineReferenceMutation } from "./inline-reference-validation.js";
import { requireIdentity, validateAnchor } from "./mutation-static-validation-primitives.js";
import { validateFieldDefinitionConfigMutation } from "./field-definition-config-validation.js";

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
  if (firstSequence < 1 || transaction.transactionId !== factTransactionId(workspaceId, replicaId, firstSequence)) {
    throw new Error(`Fact transaction identity does not match its position: ${fact.id}`);
  }
  if (!Number.isSafeInteger(fact.coordinate.lamport) || fact.coordinate.lamport < 1) {
    throw new Error(`Invalid Fact Lamport rank: ${fact.id}`);
  }
  for (const [observedReplicaId, observedSequence] of Object.entries(fact.coordinate.observed)) {
    if (!isReplicaId(observedReplicaId) || !Number.isSafeInteger(observedSequence) || observedSequence < 0) {
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

function validateMaintenanceAction(action: Extract<FactBody, { kind: "maintenance" }>["action"], id: string): void {
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
  if (action.kind === "node-purge" && action.retiredReplicaIds.some((replicaId) => !isReplicaId(replicaId))) {
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
      validateNodeOwnerMutation(mutation, factIdentity);
      return;
    case "metanode-attach":
      requireIdentity(mutation.hostNodeId, "configuration host Node", factIdentity);
      requireIdentity(mutation.metanodeId, "metanode Node", factIdentity);
      if (mutation.hostNodeId === mutation.metanodeId) {
        throw new Error(`Metanode cannot attach to itself: ${factIdentity}`);
      }
      return;
    case "intrinsic-node-type-declare":
      requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
      return;
    case "supertag-apply":
    case "supertag-remove":
    case "supertag-extension-add":
    case "supertag-extension-remove":
    case "supertag-template-node-add":
    case "supertag-template-node-remove":
    case "supertag-template-field-attach":
    case "supertag-template-field-existing-attach":
    case "supertag-template-field-detach":
    case "supertag-template-field-discoverability-set":
    case "supertag-template-field-visibility-configure":
    case "supertag-optional-field-contribution-attach":
    case "supertag-optional-field-contribution-detach":
      validateSupertagMutation(mutation, factIdentity);
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
    case "field-datatype-configure":
    case "field-cardinality-configure":
    case "field-optionality-configure":
    case "field-initialization-expression-configure":
      validateFieldDefinitionConfigMutation(mutation, factIdentity);
      return;
    case "text-splice":
      validateTextSplice(mutation, factIdentity);
      return;
    case "text-mark":
      requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
      requireIdentity(mutation.key, "mark key", factIdentity);
      if (mutation.previous === undefined) {
        throw new Error(`Text mark lacks semantic evidence: ${factIdentity}`);
      }
      if (mutation.atomIds.length === 0 || new Set(mutation.atomIds).size !== mutation.atomIds.length) {
        throw new Error(`Text mark targets are empty or duplicated: ${factIdentity}`);
      }
      return;
    case "inline-reference-create":
    case "inline-reference-delete":
    case "inline-reference-alias-attach":
    case "inline-reference-alias-detach":
      validateInlineReferenceMutation(mutation, factIdentity);
      return;
    case "search-expression-attach":
    case "search-expression-detach":
      validateSearchExpressionMutation(mutation, factIdentity);
      return;
    case "shared-default-view-definition-attach":
    case "shared-default-view-definition-detach":
    case "shared-default-view-definition-mode-set":
    case "shared-default-view-definition-sort-by-name-set":
    case "shared-default-view-definition-options-set":
      validateViewMutation(mutation, factIdentity);
      return;
    default:
      assertNever(mutation);
  }
}

function validateNodeOwnerMutation(
  mutation: Extract<Mutation, { kind: "node-owner-set" }>,
  factIdentity: string,
): void {
  requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
  if (mutation.ownerNodeId !== null) {
    requireIdentity(mutation.ownerNodeId, mutation.kind, factIdentity);
  }
  if (mutation.previousOwnerNodeId === undefined) {
    throw new Error(`Node owner mutation lacks semantic evidence: ${factIdentity}`);
  }
  if (mutation.previousOwnerNodeId !== null) {
    requireIdentity(mutation.previousOwnerNodeId, "previous owner Node", factIdentity);
  }
}

function validateTextSplice(mutation: Extract<Mutation, { kind: "text-splice" }>, factIdentity: string): void {
  requireIdentity(mutation.nodeId, mutation.kind, factIdentity);
  validateAnchor(mutation.anchor, factIdentity);
  validateStaticTextSpliceEvidence(mutation, factIdentity);
}

function validateNodeCreation(mutation: Extract<Mutation, { kind: "node-create" }>, factIdentity: string): void {
  requireIdentity(mutation.nodeId, "node-create", factIdentity);
  if (mutation.seed?.text.some((atom) => !isWellFormedUnicode(atom.value))) {
    throw new Error(`Node seed contains an unpaired surrogate: ${factIdentity}`);
  }
}

function validateOccurrenceMutation(mutation: OccurrenceMutation, factIdentity: string): void {
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

function requireNullableIdentity(value: string | null, label: string, factIdentity: string): void {
  if (value !== null) {
    requireIdentity(value, label, factIdentity);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Mutation validation: ${JSON.stringify(value)}`);
}
