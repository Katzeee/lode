import type { ContributionMutation as ProtocolContributionMutation } from "@lode/protocol/dto/fact";
import { ContributionMutationSchema } from "@lode/protocol/proto";
import type { ContributionMutation } from "./fact.js";
import type { FieldInitializationExpression } from "./model.js";
import { fromProtocolMessage, toProtocolMessage } from "./protocol-message-codec.js";
import { fromProtocolValue, required, toProtocolValue } from "./protocol-shape-codec.js";
import { fromSearchExpressionSpec, toSearchExpressionSpec } from "./protocol-search-expression-codec.js";
import { fromViewOptionsSpec, toViewOptionsSpec } from "./protocol-view-options-codec.js";

type ProtocolContributionMutationCase = NonNullable<
  ReturnType<typeof ProtocolContributionMutation.decode>["mutation"]
>["$case"];

const KIND_BY_CASE = {
  nodeCreate: "node-create",
  nodeDelete: "node-delete",
  nodeRestore: "node-restore",
  occurrenceCreate: "occurrence-create",
  occurrenceDelete: "occurrence-delete",
  occurrenceRestore: "occurrence-restore",
  occurrenceMove: "occurrence-move",
  nodeOwnerSet: "node-owner-set",
  metanodeAttach: "metanode-attach",
  declareIntrinsicNodeType: "intrinsic-node-type-declare",
  supertagApply: "supertag-apply",
  supertagRemove: "supertag-remove",
  supertagExtensionAdd: "supertag-extension-add",
  supertagExtensionRemove: "supertag-extension-remove",
  supertagTemplateNodeAdd: "supertag-template-node-add",
  supertagTemplateNodeRemove: "supertag-template-node-remove",
  templateNodeDetach: "template-node-detach",
  fieldMaterialize: "field-materialize",
  fieldValueDelete: "field-value-delete",
  materializedFieldDelete: "materialized-field-delete",
  textSplice: "text-splice",
  textMark: "text-mark",
  inlineReferenceCreate: "inline-reference-create",
  inlineReferenceDelete: "inline-reference-delete",
  inlineReferenceAliasAttach: "inline-reference-alias-attach",
  inlineReferenceAliasDetach: "inline-reference-alias-detach",
  searchExpressionAttach: "search-expression-attach",
  searchExpressionDetach: "search-expression-detach",
  sharedDefaultViewDefinitionAttach: "shared-default-view-definition-attach",
  sharedDefaultViewDefinitionDetach: "shared-default-view-definition-detach",
  sharedDefaultViewDefinitionModeSet: "shared-default-view-definition-mode-set",
  sharedDefaultViewDefinitionSortByNameSet: "shared-default-view-definition-sort-by-name-set",
  sharedDefaultViewDefinitionOptionsSet: "shared-default-view-definition-options-set",
  fieldDatatypeConfigure: "field-datatype-configure",
  fieldCardinalityConfigure: "field-cardinality-configure",
  fieldOptionalityConfigure: "field-optionality-configure",
  fieldInitializationExpressionConfigure: "field-initialization-expression-configure",
  supertagTemplateFieldAttach: "supertag-template-field-attach",
  supertagTemplateFieldExistingAttach: "supertag-template-field-existing-attach",
  supertagTemplateFieldDetach: "supertag-template-field-detach",
  supertagTemplateFieldDiscoverabilitySet: "supertag-template-field-discoverability-set",
  supertagOptionalFieldContributionAttach: "supertag-optional-field-contribution-attach",
  supertagOptionalFieldContributionDetach: "supertag-optional-field-contribution-detach",
  supertagTemplateFieldVisibilityConfigure: "supertag-template-field-visibility-configure",
} as const satisfies Readonly<Record<ProtocolContributionMutationCase, ContributionMutation["kind"]>>;

type AssertNever<Value extends never> = Value;
export type ContributionMutationCoverage = AssertNever<
  Exclude<ContributionMutation["kind"], (typeof KIND_BY_CASE)[ProtocolContributionMutationCase]>
>;

export function toContributionMutation(mutation: ContributionMutation): Record<string, unknown> {
  assertMutationFields(mutation);
  const value = toProtocolValue(mutation) as Record<string, unknown>;
  delete value.kind;
  if (mutation.kind === "text-splice") {
    value.deletedAtoms = mutation.deletedAtoms === undefined ? null : { values: mutation.deletedAtoms };
    value.attributes = mutation.attributes === undefined ? null : { values: mutation.attributes };
  } else if (mutation.kind === "node-owner-set") {
    value.ownerNodeId = currentOwnerToProtocol(mutation.ownerNodeId);
    value.previousOwnerNodeId = previousScalarToProtocol(mutation.previousOwnerNodeId);
  } else if (mutation.kind === "field-datatype-configure") {
    value.previousDatatypeNodeId = previousScalarToProtocol(mutation.previousDatatypeNodeId);
  } else if (mutation.kind === "field-cardinality-configure") {
    value.previousCardinalityNodeId = previousScalarToProtocol(mutation.previousCardinalityNodeId);
  } else if (mutation.kind === "field-optionality-configure") {
    value.previousOptionalityNodeId = previousScalarToProtocol(mutation.previousOptionalityNodeId);
  } else if (mutation.kind === "field-initialization-expression-configure") {
    value.expression = expressionToProtocol(mutation.expression);
    value.previousExpression = previousExpressionToProtocol(mutation.previousExpression);
  } else if (mutation.kind === "search-expression-attach") {
    value.expression = toSearchExpressionSpec(mutation.expression);
    value.previousExpression =
      mutation.previousExpression === undefined ? null : toSearchExpressionSpec(mutation.previousExpression);
  } else if (mutation.kind === "search-expression-detach") {
    value.expression = toSearchExpressionSpec(mutation.expression);
  } else if (mutation.kind === "shared-default-view-definition-options-set") {
    value.options = toViewOptionsSpec(mutation.options);
    value.previousOptions = mutation.previousOptions === undefined ? null : toViewOptionsSpec(mutation.previousOptions);
  }
  const wrapped = { mutation: { $case: caseFor(mutation.kind), value } };
  return toProtocolMessage(ContributionMutationSchema, wrapped) as Record<string, unknown>;
}

export function fromContributionMutation(value: unknown): ContributionMutation {
  const decodedMessage = fromProtocolMessage(ContributionMutationSchema, value) as ReturnType<
    typeof ProtocolContributionMutation.decode
  >;
  const selected = required(decodedMessage.mutation, "Contribution mutation");
  const raw = selected.value as unknown as Record<string, unknown>;
  const decoded = fromProtocolValue(selected.value) as Record<string, unknown>;
  if (selected.$case === "nodeOwnerSet") {
    decoded.ownerNodeId = currentOwnerFromProtocol(raw.ownerNodeId);
    assignOptional(decoded, "previousOwnerNodeId", previousScalarFromProtocol(raw.previousOwnerNodeId));
  } else if (selected.$case === "textSplice") {
    assignOptional(decoded, "deletedAtoms", optionalValuesFromProtocol(decoded.deletedAtoms));
    assignOptional(decoded, "attributes", optionalValuesFromProtocol(decoded.attributes));
  } else if (selected.$case === "fieldDatatypeConfigure") {
    assignOptional(decoded, "previousDatatypeNodeId", previousScalarFromProtocol(raw.previousDatatypeNodeId));
  } else if (selected.$case === "fieldCardinalityConfigure") {
    assignOptional(decoded, "previousCardinalityNodeId", previousScalarFromProtocol(raw.previousCardinalityNodeId));
  } else if (selected.$case === "fieldOptionalityConfigure") {
    assignOptional(decoded, "previousOptionalityNodeId", previousScalarFromProtocol(raw.previousOptionalityNodeId));
  } else if (selected.$case === "fieldInitializationExpressionConfigure") {
    decoded.expression = expressionFromProtocol(decoded.expression);
    assignOptional(decoded, "previousExpression", previousExpressionFromProtocol(raw.previousExpression));
  } else if (selected.$case === "searchExpressionAttach") {
    decoded.expression = fromSearchExpressionSpec(raw.expression);
    if (raw.previousExpression !== null) {
      decoded.previousExpression = fromSearchExpressionSpec(raw.previousExpression);
    }
  } else if (selected.$case === "searchExpressionDetach") {
    decoded.expression = fromSearchExpressionSpec(raw.expression);
  } else if (selected.$case === "sharedDefaultViewDefinitionOptionsSet") {
    decoded.options = fromViewOptionsSpec(raw.options);
    if (raw.previousOptions !== null) {
      decoded.previousOptions = fromViewOptionsSpec(raw.previousOptions);
    }
  }
  for (const key of [
    "seed",
    "previousParentNodeId",
    "previousHostNodeId",
    "previousTargetNodeId",
    "previousAnchor",
    "previous",
    "previousDiscoverable",
  ] as const) {
    if (decoded[key] === null) {
      delete decoded[key];
    }
  }
  for (const key of ["sourceSupertagIds", "sourceApplicationSupertagIds", "sourceTemplateOccurrenceIds"] as const) {
    if (Array.isArray(decoded[key]) && decoded[key].length === 0) {
      delete decoded[key];
    }
  }
  return { ...decoded, kind: KIND_BY_CASE[selected.$case] } as ContributionMutation;
}

function previousScalarToProtocol(value: string | null | undefined): unknown {
  if (value === undefined) {
    return null;
  }
  return value === null ? { state: { $case: "unset", value: {} } } : { state: { $case: "set", value } };
}

function currentOwnerToProtocol(value: string | null): unknown {
  return value === null ? { state: { $case: "detached", value: {} } } : { state: { $case: "ownedBy", value } };
}

function currentOwnerFromProtocol(value: unknown): string | null {
  const selected = required(
    (value as { state?: { $case: "detached" | "ownedBy"; value: unknown } | null }).state,
    "Current Node Owner",
  );
  return selected.$case === "detached" ? null : (selected.value as string);
}

function previousScalarFromProtocol(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  const selected = required(
    (value as { state?: { $case: "unset" | "set"; value: unknown } | null }).state,
    "Previous Field Definition configuration",
  );
  return selected.$case === "unset" ? null : selected.value;
}

function expressionToProtocol(expression: FieldInitializationExpression): Record<string, unknown> {
  const { kind: _kind, ...value } = expression;
  return value;
}

function expressionFromProtocol(value: unknown): Record<string, unknown> {
  const expression = required(value as Record<string, unknown> | null, "Field initialization expression");
  return { kind: "find-field-values", ...expression };
}

function previousExpressionToProtocol(value: FieldInitializationExpression | null | undefined): unknown {
  if (value === undefined) {
    return null;
  }
  return value === null
    ? { state: { $case: "unset", value: {} } }
    : { state: { $case: "set", value: expressionToProtocol(value) } };
}

function previousExpressionFromProtocol(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  const selected = required(
    (value as { state?: { $case: "unset" | "set"; value: unknown } | null }).state,
    "Previous Field initialization expression",
  );
  return selected.$case === "unset" ? null : expressionFromProtocol(selected.value);
}

function optionalValuesFromProtocol(value: unknown): unknown {
  return value === null ? undefined : (value as { values: unknown }).values;
}

function assignOptional(result: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    delete result[key];
  } else {
    result[key] = value;
  }
}

function assertMutationFields(mutation: ContributionMutation): void {
  const $case = caseFor(mutation.kind);
  const field = ContributionMutationSchema.oneofs[0]?.fields.find((candidate) => candidate.localName === $case);
  const allowed = new Set(["kind", ...(field?.message?.fields.map((candidate) => candidate.localName) ?? [])]);
  const unknown = Object.keys(mutation).find((key) => !allowed.has(key));
  if (unknown) {
    throw new Error(`Unknown input field: ${unknown}`);
  }
}

function caseFor(kind: ContributionMutation["kind"]): ProtocolContributionMutationCase {
  const entry = Object.entries(KIND_BY_CASE).find(([, value]) => value === kind);
  if (!entry) {
    throw new Error(`Protocol has no Contribution mutation case for ${kind}`);
  }
  return entry[0] as ProtocolContributionMutationCase;
}
