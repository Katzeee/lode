import {
  admitAuthorityRecordShapes,
  type Admission,
  type Fact,
  type FactSnapshot,
  type Mutation,
  type WorkspaceId,
} from "../fact/index.js";
import {
  CURRENT_PROJECTION_VERSIONS,
  assertMaterializedField,
  rebuildGeneration,
  type Projection,
} from "../reconcile/index.js";
import { validateSchemaEvidence } from "./schema-evidence.js";
import { validateTemplateDetachmentEvidence } from "./template-node-evidence.js";
import {
  validateFieldContentDeletionEvidence,
  validateFieldInitializationEvidence,
} from "./field-evidence.js";
import {
  assertNodeDeletionTarget,
  assertObservedDeletion,
  assertOccurrenceParent,
} from "../mutation-evidence/index.js";
import { validateOccurrenceCreate, validateOccurrenceEvidence } from "./occurrence-evidence.js";
import {
  validateTextMarkEvidence,
  validateTextSpliceEvidence,
  validateValueMutationEvidence,
} from "./content-evidence.js";
import { validateNodeOwnerEvidence, validateNodeTypeEvidence } from "./node-evidence.js";
import { validateDomainTransaction } from "./transaction-validation.js";

export function admitAuthorityRecords(
  workspaceId: WorkspaceId,
  records: readonly unknown[],
): Admission {
  return admitAuthorityRecordShapes(workspaceId, records, {
    validateFact: validateSemanticEvidence,
    validateTransaction: validateDomainTransaction,
  });
}

function validateSemanticEvidence(fact: Fact, observed: FactSnapshot): void {
  if (fact.body.kind !== "contribution") {
    return;
  }
  if (fact.body.mutation.kind === "node-create") {
    return;
  }
  if (fact.body.mutation.kind === "node-restore") {
    assertObservedDeletion(
      observed,
      fact.body.mutation.deletionFactId,
      "node-delete",
      fact.body.mutation.nodeId,
    );
    return;
  }
  const generation = rebuildGeneration(
    fact.workspaceId,
    observed,
    CURRENT_PROJECTION_VERSIONS,
  ).generation;
  const previous = fact.body.intent === "direct" ? generation.origin : generation.review;
  const available = generation.review;
  validateMutationEvidence(fact.body.mutation, previous, available, observed);
}

function validateMutationEvidence(
  mutation: Mutation,
  previous: Projection,
  available: Projection,
  observed: FactSnapshot,
): void {
  switch (mutation.kind) {
    case "text-splice":
      validateTextSpliceEvidence(mutation, available);
      return;
    case "text-mark":
      validateTextMarkEvidence(mutation, previous, available);
      return;
    case "value-set":
    case "value-unset":
      validateValueMutationEvidence(mutation, previous, available);
      return;
    case "occurrence-move":
    case "occurrence-delete":
      validateOccurrenceEvidence(mutation, previous, available);
      return;
    case "node-owner-set":
      validateNodeOwnerEvidence(mutation, previous, available);
      return;
    case "node-type-declare":
      validateNodeTypeEvidence(mutation, available);
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
      validateSchemaEvidence(mutation, previous, available);
      return;
    case "template-node-detach":
      validateTemplateDetachmentEvidence(mutation, available);
      return;
    case "field-materialize":
      assertMaterializedField(mutation, available);
      return;
    case "field-initialize":
      validateFieldInitializationEvidence(mutation, available);
      return;
    case "field-value-delete":
    case "materialized-field-delete":
      validateFieldContentDeletionEvidence(mutation, previous, available);
      return;
    case "node-delete":
      assertNodeDeletionTarget(mutation, available);
      return;
    case "occurrence-create":
      validateOccurrenceCreate(mutation, available);
      return;
    case "occurrence-restore":
      assertObservedDeletion(
        observed,
        mutation.deletionFactId,
        "occurrence-delete",
        mutation.occurrenceId,
      );
      assertOccurrenceParent(available, mutation.parentNodeId);
      break;
    case "node-create":
    case "node-restore":
      break;
  }
}
