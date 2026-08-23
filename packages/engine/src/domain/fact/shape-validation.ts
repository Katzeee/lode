import { type FactBody, type AuthoredAction, type SequenceAnchor } from "./types.js";
import type { AuthorityReceipt } from "./authority-types.js";
import { AUTHORED_ACTION_SHAPE_KEYS } from "./authored-action-shape-keys.js";
import { assertOptionalNodeSeed } from "./node-create-shape.js";
import { isIntrinsicNodeType } from "./intrinsic-node-type-types.js";
import { assertSupertagActionShape } from "./supertag-action-shape.js";
import { assertFactBody } from "./fact-body-shape-validation.js";
import { requireFactIds } from "./identities.js";
import { assertTemplateDetachmentShape } from "./template-node-validation.js";
import { assertFieldContentDeletionShape } from "./field-content-validation.js";
import { assertSearchExpressionActionShape } from "./search-expression-validation.js";
import { assertInlineReferenceActionShape } from "./inline-reference-validation.js";
import { assertViewActionShape } from "./view-definition-validation.js";
import { assertFieldConfigurationSetActionShape } from "./field-definition-config-shape.js";
import { isFactActionId } from "./identities.js";
import { assertTextActionShape } from "./text-action-shape.js";
import { isSupertagAction } from "./action-family.js";
import {
  assertKeys,
  assertNullableString,
  assertObject,
  assertOneOf,
  requireSafeInteger,
  requireString,
} from "../../decoding/index.js";

export function parseFactBody(value: unknown): FactBody {
  assertFactBody(value, assertAuthoredActionShape);
  return value;
}

export function parseAuthorityReceipt(value: unknown): AuthorityReceipt {
  assertReceipt(value);
  return value;
}

function assertReceipt(value: unknown): asserts value is AuthorityReceipt {
  assertObject(value, "receipt");
  assertKeys(
    value,
    ["workspaceId", "replicaId", "invocationId", "requestDigest", "factIds", "committedFrontier", "lineage", "inverse"],
    "receipt",
  );
  requireString(value.workspaceId, "receipt Workspace identity");
  requireString(value.replicaId, "receipt Replica identity");
  requireString(value.invocationId, "receipt Invocation identity");
  requireString(value.requestDigest, "receipt request digest");
  requireFactIds(value.factIds, "receipt Fact identities");
  assertFrontier(value.committedFrontier, "receipt committed frontier");
  assertReceiptInverse(value.inverse);
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

function assertReceiptInverse(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error("receipt inverse must be an array");
  }
  for (const batch of value) {
    assertObject(batch, "receipt inverse batch");
    assertKeys(batch, ["intent", "actions"], "receipt inverse batch");
    assertOneOf(batch.intent, ["direct", "proposal"], "receipt inverse intent");
    if (!Array.isArray(batch.actions) || batch.actions.length === 0) {
      throw new Error("receipt inverse batch requires at least one AuthoredAction");
    }
    batch.actions.forEach(assertAuthoredActionShape);
  }
}

function assertAuthoredActionShape(value: unknown): asserts value is AuthoredAction {
  assertObject(value, "AuthoredAction");
  requireString(value.kind, "AuthoredAction kind");
  const keys = AUTHORED_ACTION_SHAPE_KEYS[value.kind];
  if (!keys) {
    throw new Error(`Unknown AuthoredAction kind: ${value.kind}`);
  }
  assertKeys(value, keys, `${value.kind} AuthoredAction`);
  if (value.kind === "field-configuration-set") {
    assertFieldConfigurationSetActionShape(value);
    return;
  }
  if (value.kind === "field-definition-make-discoverable") {
    requireString(value.fieldDefinitionId, "Field Definition identity");
    return;
  }
  if (value.kind === "field-definition-return-to-template-field") {
    requireString(value.fieldDefinitionId, "Field Definition identity");
    if (typeof value.templateFieldId !== "string" || !isFactActionId(value.templateFieldId)) {
      throw new Error("Template Field identity must be a Fact Action identity");
    }
    return;
  }
  if (value.kind === "rich-text-splice" || value.kind === "rich-text-mark") {
    assertTextActionShape(value, assertAnchor);
    return;
  }
  if (isSupertagAction(value as AuthoredAction)) {
    assertSupertagActionShape(value);
    return;
  }
  if (assertViewActionShape(value)) {
    return;
  }
  switch (value.kind) {
    case "workspace-bootstrap":
      requireString(value.workspaceNodeId, "Workspace Node identity");
      return;
    case "node-create":
      requireString(value.nodeId, value.kind);
      requireString(value.ownerNodeId, `Owner Node identity for ${String(value.nodeId)}`);
      assertOriginalPlacement(value.originalPlacement);
      if (value.intrinsicNodeType !== undefined && !isIntrinsicNodeType(value.intrinsicNodeType)) {
        throw new Error("Intrinsic Node Type is invalid");
      }
      assertOptionalNodeSeed(value.seed);
      return;
    case "node-trash":
      requireString(value.nodeId, value.kind);
      return;
    case "node-restore":
      requireString(value.nodeId, value.kind);
      requireString(value.placementId, "restored Placement identity");
      requireString(value.parentNodeId, "restored parent Node identity");
      assertAnchor(value.anchor);
      return;
    case "original-promote":
      requireString(value.nodeId, "promoted Node identity");
      requireString(value.placementId, "promoted Placement identity");
      return;
    case "placement-create":
    case "placement-remove":
    case "placement-move":
      assertPlacementActionShape(value);
      return;
    case "field-materialize":
      requireString(value.ownerNodeId, "Field owner Node identity");
      requireString(value.fieldDefinitionId, "Field Definition identity");
      requireString(value.fieldNodeId, "Field Node identity");
      requireString(value.fieldOccurrenceId, "Field Occurrence identity");
      return;
    case "field-value-remove":
    case "materialized-field-clear":
      assertFieldContentDeletionShape(value);
      return;
    case "template-node-detach":
      assertTemplateDetachmentShape(value);
      return;
    case "inline-reference-create":
    case "inline-reference-remove":
    case "inline-alias-attach":
    case "inline-alias-detach":
      assertInlineReferenceActionShape(value);
      return;
    case "search-expression-add":
    case "search-expression-configure":
    case "search-expression-move":
    case "search-expression-remove":
    case "search-expression-restore":
      assertSearchExpressionActionShape(value);
      return;
    default:
      throw new Error(`Unknown AuthoredAction kind: ${value.kind}`);
  }
}

function assertOriginalPlacement(value: unknown): void {
  if (value === null) {
    return;
  }
  assertObject(value, "Original Placement");
  assertKeys(value, ["placementId", "anchor"], "Original Placement");
  requireString(value.placementId, "Original Placement identity");
  assertAnchor(value.anchor);
}

function assertPlacementActionShape(value: Record<string, unknown>): void {
  requireString(value.placementId, "Placement identity");
  if (value.kind === "placement-create") {
    requireString(value.nodeId, "Placement Node identity");
  }
  if (value.kind === "placement-create" || value.kind === "placement-move") {
    requireString(value.parentNodeId, "Parent Node");
    assertAnchor(value.anchor);
  }
}

export function parseAuthoredAction<Kind extends AuthoredAction["kind"]>(
  value: Readonly<{ kind: Kind }> & Record<string, unknown>,
): Extract<AuthoredAction, { kind: Kind }>;
export function parseAuthoredAction(value: unknown): AuthoredAction;
export function parseAuthoredAction(value: unknown): AuthoredAction {
  assertAuthoredActionShape(value);
  return value;
}

export function isAuthoredActionKind(value: unknown): value is AuthoredAction["kind"] {
  return typeof value === "string" && value in AUTHORED_ACTION_SHAPE_KEYS;
}

function assertAnchor(value: unknown): asserts value is SequenceAnchor {
  assertObject(value, "Sequence anchor");
  assertKeys(value, ["after", "before", "affinity", "fallback"], "Sequence anchor");
  assertNullableString(value.after, "anchor after");
  assertNullableString(value.before, "anchor before");
  assertOneOf(value.affinity, ["after", "before"], "anchor affinity");
  assertOneOf(value.fallback, ["start", "end"], "anchor fallback");
}

function assertFrontier(value: unknown, label: string): void {
  assertObject(value, label);
  for (const [replicaId, sequence] of Object.entries(value)) {
    requireString(replicaId, `${label} Replica identity`);
    requireSafeInteger(sequence, 0, `${label} sequence`);
  }
}
