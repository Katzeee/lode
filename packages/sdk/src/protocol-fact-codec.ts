import type { ContributionMutation as ProtocolContributionMutation } from "@lode/protocol/dto/fact";
import { ContributionMutationSchema } from "@lode/protocol/proto";
import type { ContributionMutation, InitializedFieldValue } from "./fact.js";
import type { FieldTemplateConfig } from "./model.js";
import { fromProtocolMessage, toProtocolMessage } from "./protocol-message-codec.js";
import {
  fromFieldTemplateConfig,
  fromProtocolValue,
  required,
  toFieldTemplateConfig,
  toProtocolValue,
} from "./protocol-shape-codec.js";

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
  nodeTypeDeclare: "node-type-declare",
  schemaApply: "schema-apply",
  schemaRemove: "schema-remove",
  schemaFieldAdd: "schema-field-add",
  schemaFieldRemove: "schema-field-remove",
  schemaFieldConfigure: "schema-field-configure",
  schemaExtensionAdd: "schema-extension-add",
  schemaExtensionRemove: "schema-extension-remove",
  schemaTemplateNodeAdd: "schema-template-node-add",
  schemaTemplateNodeRemove: "schema-template-node-remove",
  templateNodeDetach: "template-node-detach",
  fieldMaterialize: "field-materialize",
  fieldValueDelete: "field-value-delete",
  materializedFieldDelete: "materialized-field-delete",
  fieldInitialize: "field-initialize",
  textSplice: "text-splice",
  textMark: "text-mark",
  valueSet: "value-set",
  valueUnset: "value-unset",
} as const satisfies Readonly<Record<ProtocolContributionMutationCase, ContributionMutation["kind"]>>;

type AssertNever<Value extends never> = Value;
export type ContributionMutationCoverage = AssertNever<
  Exclude<ContributionMutation["kind"], (typeof KIND_BY_CASE)[ProtocolContributionMutationCase]>
>;

export function toContributionMutation(mutation: ContributionMutation): Record<string, unknown> {
  assertMutationFields(mutation);
  const value = toProtocolValue(mutation) as Record<string, unknown>;
  delete value.kind;
  if (mutation.kind === "schema-field-configure") {
    value.config = toFieldTemplateConfig(mutation.config);
    value.previousConfig = previousConfigToProtocol(mutation.previousConfig);
    value.observedConfigFactIds = optionalStrings(mutation.observedConfigFactIds);
  } else if (mutation.kind === "field-initialize") {
    value.values = mutation.values.map(toInitializedFieldValue);
    value.observedInitializationFactIds = optionalStrings(mutation.observedInitializationFactIds);
  } else if (mutation.kind === "text-splice") {
    value.deletedAtoms = mutation.deletedAtoms === undefined ? null : { values: mutation.deletedAtoms };
    value.attributes = mutation.attributes === undefined ? null : { values: mutation.attributes };
  } else if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
    value.target = { target: { $case: mutation.target.kind, value: mutation.target.id } };
  }
  const wrapped = { mutation: { $case: caseFor(mutation.kind), value } };
  return toProtocolMessage(ContributionMutationSchema, wrapped) as Record<string, unknown>;
}

export function fromContributionMutation(value: unknown): ContributionMutation {
  const decodedMessage = fromProtocolMessage(ContributionMutationSchema, value) as ReturnType<
    typeof ProtocolContributionMutation.decode
  >;
  const selected = required(decodedMessage.mutation, "Contribution mutation");
  const decoded = fromProtocolValue(selected.value) as Record<string, unknown>;
  if (selected.$case === "schemaFieldConfigure") {
    decoded.config = fromFieldTemplateConfig(decoded.config);
    assignOptional(decoded, "previousConfig", previousConfigFromProtocol(decoded.previousConfig));
    assignOptional(decoded, "observedConfigFactIds", optionalStringsFromProtocol(decoded.observedConfigFactIds));
  } else if (selected.$case === "fieldInitialize") {
    decoded.values = (decoded.values as readonly unknown[]).map(fromInitializedFieldValue);
    assignOptional(
      decoded,
      "observedInitializationFactIds",
      optionalStringsFromProtocol(decoded.observedInitializationFactIds),
    );
  } else if (selected.$case === "textSplice") {
    assignOptional(decoded, "deletedAtoms", optionalValuesFromProtocol(decoded.deletedAtoms));
    assignOptional(decoded, "attributes", optionalValuesFromProtocol(decoded.attributes));
  } else if (selected.$case === "valueSet" || selected.$case === "valueUnset") {
    const target = required(
      decoded.target as { target: { $case: "node" | "occurrence"; value: string } | null } | null,
      "Value target",
    );
    const selectedTarget = required(target.target, "Value target");
    decoded.target = { kind: selectedTarget.$case, id: selectedTarget.value };
  }
  for (const key of ["seed", "previousOwnerNodeId", "previousParentNodeId", "previousAnchor", "previous"] as const) {
    if (decoded[key] === null) {
      delete decoded[key];
    }
  }
  for (const key of ["sourceSchemaIds", "sourceApplicationSchemaIds", "sourceTemplateOccurrenceIds"] as const) {
    if (Array.isArray(decoded[key]) && decoded[key].length === 0) {
      delete decoded[key];
    }
  }
  return { ...decoded, kind: KIND_BY_CASE[selected.$case] } as ContributionMutation;
}

function toInitializedFieldValue(value: InitializedFieldValue): Record<string, unknown> {
  const { kind, ...fields } = value;
  return { value: { $case: kind, value: fields } };
}

function fromInitializedFieldValue(value: unknown): InitializedFieldValue {
  const selected = required(
    (value as { value?: { $case: "text" | "reference"; value: Record<string, unknown> } | null }).value,
    "Initialized Field value",
  );
  return { ...selected.value, kind: selected.$case } as InitializedFieldValue;
}

function previousConfigToProtocol(value: FieldTemplateConfig | null | undefined): unknown {
  if (value === undefined) {
    return null;
  }
  return value === null
    ? { state: { $case: "unset", value: {} } }
    : { state: { $case: "set", value: toFieldTemplateConfig(value) } };
}

function previousConfigFromProtocol(value: unknown): unknown {
  if (value === null) {
    return undefined;
  }
  const selected = required(
    (value as { state?: { $case: "unset" | "set"; value: unknown } | null }).state,
    "Previous Field config",
  );
  return selected.$case === "unset" ? null : fromFieldTemplateConfig(selected.value);
}

function optionalStrings(value: readonly string[] | undefined): { values: readonly string[] } | null {
  return value === undefined ? null : { values: value };
}

function optionalStringsFromProtocol(value: unknown): readonly string[] | undefined {
  return value === null ? undefined : (value as { values: readonly string[] }).values;
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
