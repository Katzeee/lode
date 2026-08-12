import type {
  AuthorityReceipt,
  AuthorityRecord,
  Fact,
  FactBody,
  Mutation,
  SequenceAnchor,
} from "./types.js";
import { MUTATION_SHAPE_KEYS } from "./mutation-shape-keys.js";
import { assertSchemaMutationShape } from "./schema-mutation-shape.js";
import {
  assertJsonValue,
  assertFrontier,
  assertKeys,
  assertNullableString,
  assertObject,
  assertOneOf,
  assertStringArray,
  requireNumber,
  requireSafeInteger,
  requireString,
  requireStringAllowEmpty,
} from "./shape-validation-primitives.js";

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
    [
      "workspaceId",
      "replicaId",
      "invocationId",
      "requestDigest",
      "factIds",
      "committedFrontier",
      "lineage",
    ],
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
  assertKeys(
    value.lineage,
    ["channelId", "ordinal", "parentStepId", "operation", "targetStepId"],
    "receipt lineage",
  );
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
      "coordinate",
      "body",
      "contentDigest",
    ],
    "Fact",
  );
  requireNumber(value.formatGeneration, "Fact format generation");
  requireNumber(value.schemaVersion, "Fact schema version");
  requireString(value.workspaceId, "Fact Workspace identity");
  requireString(value.id, "Fact identity");
  requireString(value.contentDigest, "Fact content digest");
  assertObject(value.coordinate, "Fact coordinate");
  assertKeys(value.coordinate, ["dot", "observed", "lamport"], "Fact coordinate");
  assertObject(value.coordinate.dot, "Fact dot");
  assertKeys(value.coordinate.dot, ["replicaId", "sequence"], "Fact dot");
  requireString(value.coordinate.dot.replicaId, "Fact Replica identity");
  requireNumber(value.coordinate.dot.sequence, "Fact sequence");
  requireNumber(value.coordinate.lamport, "Fact Lamport rank");
  assertFrontier(value.coordinate.observed, "Fact observed frontier");
  assertBody(value.body);
}

function assertBody(value: unknown): asserts value is FactBody {
  assertObject(value, "Fact body");
  requireString(value.actorId, "Fact actor identity");
  if (value.kind === "resolution") {
    assertKeys(
      value,
      ["kind", "actorId", "decision", "proposalContributionIds", "adjudicatesResolutionIds"],
      "Resolution",
    );
    if (value.decision !== "accept" && value.decision !== "reject") {
      throw new Error("Invalid Resolution decision shape");
    }
    assertStringArray(value.proposalContributionIds, "Resolution targets");
    assertStringArray(value.adjudicatesResolutionIds, "adjudicated Resolution identities");
    return;
  }
  if (value.kind !== "contribution") {
    throw new Error("Unknown Fact body kind");
  }
  assertKeys(value, ["kind", "actorId", "intent", "mutation"], "Contribution");
  if (value.intent !== "direct" && value.intent !== "proposal") {
    throw new Error("Invalid Contribution intent shape");
  }
  assertMutation(value.mutation);
}

function assertMutation(value: unknown): asserts value is Mutation {
  assertObject(value, "Mutation");
  requireString(value.kind, "Mutation kind");
  const keys = MUTATION_SHAPE_KEYS[value.kind];
  if (!keys) {
    throw new Error(`Unknown Mutation kind: ${value.kind}`);
  }
  assertKeys(value, keys, `${value.kind} Mutation`);
  switch (value.kind) {
    case "node-create":
    case "node-delete":
      requireString(value.nodeId, value.kind);
      return;
    case "node-restore":
      requireString(value.nodeId, value.kind);
      requireString(value.deletionFactId, "node deletion Fact");
      return;
    case "occurrence-create":
      requireString(value.occurrenceId, value.kind);
      requireString(value.nodeId, value.kind);
      assertNullableString(value.parentOccurrenceId, "Occurrence parent");
      assertOneOf(value.parentPolicy, ["cascade", "rehome"], "Occurrence parent policy");
      assertAnchor(value.anchor);
      return;
    case "occurrence-delete":
      requireString(value.occurrenceId, value.kind);
      assertOneOf(value.childPolicy, ["cascade", "rehome"], "Occurrence child policy");
      assertOptionalNullableString(value.previousParentOccurrenceId, "previous parent");
      assertOptionalAnchor(value.previousAnchor);
      return;
    case "occurrence-restore":
      requireString(value.occurrenceId, value.kind);
      requireString(value.deletionFactId, "occurrence deletion Fact");
      assertNullableString(value.parentOccurrenceId, "Occurrence parent");
      assertAnchor(value.anchor);
      return;
    case "occurrence-move":
      requireString(value.occurrenceId, value.kind);
      assertNullableString(value.parentOccurrenceId, "Occurrence parent");
      assertAnchor(value.anchor);
      assertOptionalNullableString(value.previousParentOccurrenceId, "previous parent");
      assertOptionalAnchor(value.previousAnchor);
      return;
    case "canonical-occurrence-set":
      requireString(value.nodeId, value.kind);
      requireString(value.occurrenceId, value.kind);
      assertOptionalNullableString(value.previousOccurrenceId, "previous canonical");
      return;
    case "schema-apply":
    case "schema-remove":
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
    case "field-materialize":
    case "field-initialize":
      assertSchemaMutationShape(value);
      return;
    case "text-splice":
      requireString(value.nodeId, value.kind);
      assertStringArray(value.deleteAtomIds, "deleted Text Atom identities");
      assertAnchor(value.anchor);
      requireStringAllowEmpty(value.insert, "inserted text");
      assertOptionalAttributes(value.attributes);
      assertDeletedAtoms(value.deletedAtoms);
      return;
    case "text-mark":
      requireString(value.nodeId, value.kind);
      assertStringArray(value.atomIds, "marked Text Atom identities");
      requireString(value.key, "mark key");
      assertPrevious(value.value, "mark value");
      assertOptionalPrevious(value.previous);
      return;
    case "value-set":
    case "value-unset":
      assertValueOwner(value.owner);
      assertOneOf(value.namespace, ["property", "metadata", "schema"], "value namespace");
      requireString(value.key, "value key");
      if (value.kind === "value-set") {
        assertJsonValue(value.value, "value");
      }
      assertOptionalPrevious(value.previous);
      return;
    default:
      throw new Error(`Unknown Mutation kind: ${value.kind}`);
  }
}

export function parseMutation(value: unknown): Mutation {
  assertMutation(value);
  return value;
}

function assertValueOwner(value: unknown): void {
  assertObject(value, "value owner");
  assertKeys(value, ["kind", "id"], "value owner");
  assertOneOf(value.kind, ["node", "occurrence", "schema", "field"], "value owner kind");
  requireString(value.id, "value owner identity");
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

function assertDeletedAtoms(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error("Deleted Text Atom evidence must be an array");
  }
  for (const atom of value) {
    assertObject(atom, "deleted Text Atom");
    assertKeys(atom, ["id", "value", "attributes"], "deleted Text Atom");
    requireString(atom.id, "deleted Text Atom identity");
    requireStringAllowEmpty(atom.value, "deleted Text Atom value");
    assertAttributes(atom.attributes);
  }
}

function assertOptionalAttributes(value: unknown): void {
  if (value !== undefined) {
    assertAttributes(value);
  }
}

function assertAttributes(value: unknown): void {
  assertObject(value, "Text attributes");
  for (const attribute of Object.values(value)) {
    assertJsonValue(attribute, "Text attribute");
  }
}

function assertOptionalPrevious(value: unknown): void {
  if (value === undefined) {
    return;
  }
  assertPrevious(value, "previous value");
}

function assertPrevious(value: unknown, label: string): void {
  assertObject(value, label);
  assertKeys(value, value.kind === "set" ? ["kind", "value"] : ["kind"], label);
  if (value.kind === "unset") {
    return;
  }
  if (value.kind === "set") {
    assertJsonValue(value.value, label);
    return;
  }
  throw new Error(`Unknown ${label} kind`);
}

function assertOptionalNullableString(value: unknown, label: string): void {
  if (value !== undefined) {
    assertNullableString(value, label);
  }
}
