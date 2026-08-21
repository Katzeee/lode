import type { AuthorityReceipt, AuthorityRecord, Fact, Mutation, SequenceAnchor } from "./types.js";
import { MUTATION_SHAPE_KEYS } from "./mutation-shape-keys.js";
import { assertOptionalNodeSeed } from "./node-create-shape.js";
import { isIntrinsicNodeType } from "./intrinsic-node-type-types.js";
import { assertSupertagMutationShape } from "./supertag-mutation-shape.js";
import { assertFactBody } from "./fact-body-shape-validation.js";
import { assertTemplateDetachmentShape } from "./template-node-validation.js";
import { assertFieldContentDeletionShape } from "./field-content-validation.js";
import { assertSearchExpressionMutationShape } from "./search-expression-validation.js";
import { assertInlineReferenceMutationShape } from "./inline-reference-validation.js";
import {
  assertSharedDefaultViewDefinitionModeShape,
  assertSharedDefaultViewDefinitionDetachShape,
  assertSharedDefaultViewDefinitionMutationShape,
  assertSharedDefaultViewDefinitionOptionsShape,
  assertSharedDefaultViewDefinitionSortByNameShape,
} from "./view-definition-validation.js";
import { assertFieldDefinitionConfigMutationShape } from "./field-definition-config-shape.js";
import { assertTextMutationShape } from "./text-mutation-shape.js";
import { isSupertagMutation } from "./mutation-family.js";
import {
  assertKeys,
  assertNullableString,
  assertObject,
  assertOneOf,
  assertStringArray,
  requireNumber,
  requireSafeInteger,
  requireString,
} from "../../decoding/index.js";

export function parseAuthorityRecords(records: readonly unknown[]): AuthorityRecord[] {
  return records.map((record, index) => {
    assertObject(record, `authority record ${index}`);
    if (record.recordKind === "fact") {
      assertKeys(record, ["recordKind", "fact"], "Fact authority record");
      assertFact(record.fact, index);
      return { recordKind: "fact", fact: record.fact };
    }
    if (record.recordKind === "receipt") {
      assertKeys(record, ["recordKind", "receipt"], "receipt authority record");
      assertReceipt(record.receipt, index);
      return { recordKind: "receipt", receipt: record.receipt };
    }
    if (record.recordKind === "quarantine") {
      assertKeys(record, ["recordKind", "reason", "updateDigest"], "quarantine authority record");
      requireString(record.reason, "quarantine reason");
      requireString(record.updateDigest, "quarantine update digest");
      return {
        recordKind: "quarantine",
        reason: record.reason,
        updateDigest: record.updateDigest,
      };
    }
    throw new Error(`Unknown authority record kind at index ${index}`);
  });
}

function assertReceipt(value: unknown, index: number): asserts value is AuthorityReceipt {
  assertObject(value, `receipt ${index}`);
  assertKeys(
    value,
    ["workspaceId", "replicaId", "invocationId", "requestDigest", "factIds", "committedFrontier", "lineage"],
    "receipt",
  );
  requireString(value.workspaceId, "receipt Workspace identity");
  requireString(value.replicaId, "receipt Replica identity");
  requireString(value.invocationId, "receipt Invocation identity");
  requireString(value.requestDigest, "receipt request digest");
  assertStringArray(value.factIds, "receipt Fact identities");
  assertFrontier(value.committedFrontier, "receipt committed frontier");
  if (value.lineage === null) {
    return;
  }
  assertObject(value.lineage, "receipt lineage");
  assertKeys(value.lineage, ["channelId", "ordinal", "parentStepId", "operation", "targetStepId"], "receipt lineage");
  requireString(value.lineage.channelId, "History channel identity");
  requireSafeInteger(value.lineage.ordinal, 1, "History ordinal");
  assertNullableString(value.lineage.parentStepId, "History parent step");
  assertOneOf(value.lineage.operation, ["normal", "undo", "redo"], "History operation");
  assertNullableString(value.lineage.targetStepId, "History target step");
}

function assertFact(value: unknown, index: number): asserts value is Fact {
  assertObject(value, `Fact ${index}`);
  assertKeys(
    value,
    [
      "formatGeneration",
      "schemaVersion",
      "workspaceId",
      "id",
      "transaction",
      "coordinate",
      "body",
      "contentDigest",
      "attribution",
    ],
    "Fact",
  );
  requireNumber(value.formatGeneration, "Fact format generation");
  requireNumber(value.schemaVersion, "Fact schema version");
  requireString(value.workspaceId, "Fact Workspace identity");
  requireString(value.id, "Fact identity");
  requireString(value.contentDigest, "Fact content digest");
  if (value.attribution !== null) {
    requireString(value.attribution, "Fact attribution");
  }
  assertObject(value.transaction, "Fact transaction position");
  assertKeys(value.transaction, ["transactionId", "index", "size"], "Fact transaction position");
  requireString(value.transaction.transactionId, "Fact transaction identity");
  requireSafeInteger(value.transaction.index, 0, "Fact transaction index");
  requireSafeInteger(value.transaction.size, 1, "Fact transaction size");
  assertObject(value.coordinate, "Fact coordinate");
  assertKeys(value.coordinate, ["dot", "observed", "lamport"], "Fact coordinate");
  assertObject(value.coordinate.dot, "Fact dot");
  assertKeys(value.coordinate.dot, ["replicaId", "sequence"], "Fact dot");
  requireString(value.coordinate.dot.replicaId, "Fact Replica identity");
  requireNumber(value.coordinate.dot.sequence, "Fact sequence");
  requireNumber(value.coordinate.lamport, "Fact Lamport rank");
  assertFrontier(value.coordinate.observed, "Fact observed frontier");
  assertFactBody(value.body, assertMutationShape);
}

export function assertMutationShape(value: unknown): asserts value is Mutation {
  assertObject(value, "Mutation");
  requireString(value.kind, "Mutation kind");
  const keys = MUTATION_SHAPE_KEYS[value.kind];
  if (!keys) {
    throw new Error(`Unknown Mutation kind: ${value.kind}`);
  }
  assertKeys(value, keys, `${value.kind} Mutation`);
  if (
    value.kind === "field-datatype-configure" ||
    value.kind === "field-cardinality-configure" ||
    value.kind === "field-optionality-configure" ||
    value.kind === "field-initialization-expression-configure"
  ) {
    assertFieldDefinitionConfigMutationShape(value);
    return;
  }
  if (value.kind === "text-splice" || value.kind === "text-mark") {
    assertTextMutationShape(value, assertAnchor);
    return;
  }
  if (isSupertagMutation(value as Mutation)) {
    assertSupertagMutationShape(value);
    return;
  }
  if (assertViewMutationShape(value)) {
    return;
  }
  switch (value.kind) {
    case "node-create":
      requireString(value.nodeId, value.kind);
      assertOptionalNodeSeed(value.seed);
      return;
    case "node-delete":
      requireString(value.nodeId, value.kind);
      return;
    case "node-restore":
      requireString(value.nodeId, value.kind);
      requireString(value.deletionFactId, "node deletion Fact");
      return;
    case "occurrence-create":
    case "occurrence-delete":
    case "occurrence-restore":
    case "occurrence-move":
      assertOccurrenceMutationShape(value);
      return;
    case "node-owner-set":
      requireString(value.nodeId, value.kind);
      assertNullableString(value.ownerNodeId, "owner Node");
      if (value.previousOwnerNodeId !== undefined && value.previousOwnerNodeId !== null) {
        requireString(value.previousOwnerNodeId, "previous owner Node");
      }
      return;
    case "metanode-attach":
      requireString(value.hostNodeId, "configuration host Node");
      requireString(value.metanodeId, "metanode Node");
      return;
    case "intrinsic-node-type-declare":
      requireString(value.nodeId, value.kind);
      if (!isIntrinsicNodeType(value.intrinsicNodeType)) {
        throw new Error("Intrinsic Node Type is invalid");
      }
      return;
    case "field-materialize":
      requireString(value.ownerNodeId, "Field owner Node identity");
      requireString(value.fieldDefinitionId, "Field Definition identity");
      requireString(value.fieldNodeId, "Field Node identity");
      requireString(value.fieldOccurrenceId, "Field Occurrence identity");
      return;
    case "field-value-delete":
    case "materialized-field-delete":
      assertFieldContentDeletionShape(value, assertOptionalAnchor);
      return;
    case "template-node-detach":
      assertTemplateDetachmentShape(value);
      return;
    case "inline-reference-create":
    case "inline-reference-delete":
    case "inline-reference-alias-attach":
    case "inline-reference-alias-detach":
      assertInlineReferenceMutationShape(value);
      return;
    case "search-expression-attach":
    case "search-expression-detach":
      assertSearchExpressionMutationShape(value);
      return;
    default:
      throw new Error(`Unknown Mutation kind: ${value.kind}`);
  }
}

function assertViewMutationShape(value: Record<string, unknown>): boolean {
  if (value.kind === "shared-default-view-definition-attach") {
    assertSharedDefaultViewDefinitionMutationShape(value);
  } else if (value.kind === "shared-default-view-definition-detach") {
    assertSharedDefaultViewDefinitionDetachShape(value);
  } else if (value.kind === "shared-default-view-definition-mode-set") {
    assertSharedDefaultViewDefinitionModeShape(value);
  } else if (value.kind === "shared-default-view-definition-sort-by-name-set") {
    assertSharedDefaultViewDefinitionSortByNameShape(value);
  } else if (value.kind === "shared-default-view-definition-options-set") {
    assertSharedDefaultViewDefinitionOptionsShape(value);
  } else {
    return false;
  }
  return true;
}

function assertOccurrenceMutationShape(value: Record<string, unknown>): void {
  requireString(value.occurrenceId, "Occurrence identity");
  if (value.kind === "occurrence-create") {
    requireString(value.nodeId, "Occurrence Node identity");
  }
  if (value.kind === "occurrence-restore") {
    requireString(value.deletionFactId, "occurrence deletion Fact");
  }
  if (value.kind === "occurrence-create" || value.kind === "occurrence-restore" || value.kind === "occurrence-move") {
    requireString(value.parentNodeId, "Parent Node");
    assertAnchor(value.anchor);
  }
  if (
    (value.kind === "occurrence-delete" || value.kind === "occurrence-move") &&
    value.previousParentNodeId !== undefined
  ) {
    requireString(value.previousParentNodeId, "previous parent Node");
  }
  if (value.kind === "occurrence-delete" || value.kind === "occurrence-move") {
    assertOptionalAnchor(value.previousAnchor);
  }
}

export function parseMutation<Kind extends Mutation["kind"]>(
  value: Readonly<{ kind: Kind }> & Record<string, unknown>,
): Extract<Mutation, { kind: Kind }>;
export function parseMutation(value: unknown): Mutation;
export function parseMutation(value: unknown): Mutation {
  assertMutationShape(value);
  return value;
}

export function isMutationKind(value: unknown): value is Mutation["kind"] {
  return typeof value === "string" && value in MUTATION_SHAPE_KEYS;
}

function assertAnchor(value: unknown): asserts value is SequenceAnchor {
  assertObject(value, "Sequence anchor");
  assertKeys(value, ["after", "before", "affinity", "fallback"], "Sequence anchor");
  assertNullableString(value.after, "anchor after");
  assertNullableString(value.before, "anchor before");
  assertOneOf(value.affinity, ["after", "before"], "anchor affinity");
  assertOneOf(value.fallback, ["start", "end"], "anchor fallback");
}

function assertOptionalAnchor(value: unknown): void {
  if (value !== undefined) {
    assertAnchor(value);
  }
}

function assertFrontier(value: unknown, label: string): void {
  assertObject(value, label);
  for (const [replicaId, sequence] of Object.entries(value)) {
    requireString(replicaId, `${label} Replica identity`);
    requireSafeInteger(sequence, 0, `${label} sequence`);
  }
}
