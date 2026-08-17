import { atomicMutationWrite, type EditMutation, type MutationWrite } from "../../../domain/edit/index.js";
import {
  CHECKBOX_VALUE_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  type Mutation,
  type NodeSeed,
} from "../../../domain/fact/index.js";
import {
  nodeLocation,
  textAtoms,
  type FieldDefinitionConfiguration,
  type MaterializedField,
  type ScopedProjection,
} from "../../../domain/reconcile/index.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

type TypedFieldValueEdit = Extract<
  EditMutation,
  {
    kind:
      | "field-number-value-set"
      | "field-date-value-set"
      | "field-checkbox-value-set"
      | "field-options-from-supertag-value-set"
      | "typed-field-value-clear";
  }
>;

export function prepareTypedFieldValue(edit: TypedFieldValueEdit, available: ScopedProjection): MutationWrite {
  requireActive(edit.ownerNodeId, available, "Field owner");
  const datatype = configuredDatatype(edit.fieldDefinitionId, available);
  if (edit.kind === "field-number-value-set") {
    requireDatatype(datatype, FIELD_DATATYPE_NODE_IDS.number, "Number");
    return setOwnedTextValue(edit, canonicalNumber(edit.value), available);
  }
  if (edit.kind === "field-date-value-set") {
    requireDatatype(datatype, FIELD_DATATYPE_NODE_IDS.date, "Date");
    return setOwnedTextValue(edit, edit.value, available);
  }
  if (edit.kind === "field-checkbox-value-set") {
    requireDatatype(datatype, FIELD_DATATYPE_NODE_IDS.checkbox, "Checkbox");
    return setReferenceValue(edit, edit.value ? CHECKBOX_VALUE_NODE_IDS.yes : CHECKBOX_VALUE_NODE_IDS.no, available);
  }
  if (edit.kind === "field-options-from-supertag-value-set") {
    requireDatatype(datatype, FIELD_DATATYPE_NODE_IDS.optionsFromSupertag, "Options from Supertag");
    if (
      datatype.optionsSupertagId === null ||
      !matchesSupertag(edit.targetNodeId, datatype.optionsSupertagId, available)
    ) {
      throw new Error("Options target does not match the configured Supertag");
    }
    return setReferenceValue(edit, edit.targetNodeId, available);
  }
  return clearTypedFieldValue(edit, datatype, available);
}

function setOwnedTextValue(
  edit: Extract<TypedFieldValueEdit, { kind: "field-number-value-set" | "field-date-value-set" }>,
  value: string,
  available: ScopedProjection,
): MutationWrite {
  const field = fieldFor(edit, available);
  if (field === undefined) {
    requireUnusedFieldIdentity(edit, available);
    requireUnusedNode(edit.valueNodeId, available, "Field Value");
    requireUnusedOccurrence(edit.valueOccurrenceId, available, "Field Value");
    return atomicMutationWrite([
      materialization(edit),
      { kind: "node-create", nodeId: edit.valueNodeId, seed: textSeed(value) },
      { kind: "node-owner-set", nodeId: edit.valueNodeId, ownerNodeId: edit.fieldNodeId, previousOwnerNodeId: null },
      occurrence(edit.valueOccurrenceId, edit.valueNodeId, edit.fieldNodeId),
    ]);
  }
  requireFieldIdentity(edit, field);
  const current = singleValue(field, available);
  if (current.occurrenceId !== edit.valueOccurrenceId || current.nodeId !== edit.valueNodeId) {
    throw new Error("Typed Field Value identity does not match the materialized value");
  }
  if (available.nodeOwners[current.nodeId] !== field.fieldNodeId) {
    throw new Error("Number and Date values must be owned by their Field");
  }
  const node = available.nodes[current.nodeId];
  if (node === undefined || node.content.some((item) => item.kind !== "text")) {
    throw new Error("Number and Date values must contain text only");
  }
  return atomicMutationWrite([
    {
      kind: "text-splice",
      nodeId: current.nodeId,
      deleteAtomIds: textAtoms(node).map((atom) => atom.id),
      anchor: end,
      insert: value,
    },
    materialization(edit),
  ]);
}

function setReferenceValue(
  edit: Extract<TypedFieldValueEdit, { kind: "field-checkbox-value-set" | "field-options-from-supertag-value-set" }>,
  targetNodeId: string,
  available: ScopedProjection,
): MutationWrite {
  requireActive(targetNodeId, available, "Typed Field target");
  const field = fieldFor(edit, available);
  if (field === undefined) {
    requireUnusedFieldIdentity(edit, available);
    requireUnusedOccurrence(edit.valueOccurrenceId, available, "Field Value");
    return atomicMutationWrite([
      materialization(edit),
      occurrence(edit.valueOccurrenceId, targetNodeId, edit.fieldNodeId),
    ]);
  }
  requireFieldIdentity(edit, field);
  const current = singleValue(field, available);
  if (current.nodeId === targetNodeId) {
    throw new Error("Typed Field already has the requested value");
  }
  requireUnusedOccurrence(edit.valueOccurrenceId, available, "Field Value");
  return atomicMutationWrite([
    valueDeletion(edit, current.occurrenceId),
    occurrence(edit.valueOccurrenceId, targetNodeId, edit.fieldNodeId),
    materialization(edit),
  ]);
}

function clearTypedFieldValue(
  edit: Extract<TypedFieldValueEdit, { kind: "typed-field-value-clear" }>,
  datatype: Extract<FieldDefinitionConfiguration, { kind: "datatype" }>,
  available: ScopedProjection,
): MutationWrite {
  if (
    datatype.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.number &&
    datatype.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.date &&
    datatype.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.checkbox &&
    datatype.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.optionsFromSupertag
  ) {
    throw new Error("Field Datatype does not support typed clear");
  }
  const field = fieldFor(edit, available);
  if (field === undefined) {
    throw new Error("Typed Field is already unset");
  }
  requireFieldIdentity(edit, field);
  if (datatype.datatypeNodeId === FIELD_DATATYPE_NODE_IDS.checkbox) {
    if (edit.emptyValueNodeId !== undefined || edit.emptyValueOccurrenceId !== undefined) {
      throw new Error("Checkbox clear removes the Field and does not accept placeholder identities");
    }
    return atomicMutationWrite([
      {
        kind: "materialized-field-delete",
        ownerNodeId: edit.ownerNodeId,
        fieldDefinitionId: edit.fieldDefinitionId,
        fieldNodeId: edit.fieldNodeId,
        fieldOccurrenceId: edit.fieldOccurrenceId,
      },
    ]);
  }
  if (edit.emptyValueNodeId === undefined || edit.emptyValueOccurrenceId === undefined) {
    throw new Error("Typed Field clear requires fresh empty value identities");
  }
  requireUnusedNode(edit.emptyValueNodeId, available, "Empty Field Value");
  requireUnusedOccurrence(edit.emptyValueOccurrenceId, available, "Empty Field Value");
  const current = field.valueOccurrenceIds.length === 0 ? null : singleValue(field, available);
  if (
    current !== null &&
    available.nodeOwners[current.nodeId] === field.fieldNodeId &&
    textAtoms(available.nodes[current.nodeId]).length === 0
  ) {
    throw new Error("Typed Field is already empty");
  }
  const mutations: Mutation[] = [
    ...(current === null ? [] : [valueDeletion(edit, current.occurrenceId)]),
    { kind: "node-create", nodeId: edit.emptyValueNodeId },
    {
      kind: "node-owner-set",
      nodeId: edit.emptyValueNodeId,
      ownerNodeId: edit.fieldNodeId,
      previousOwnerNodeId: null,
    },
    occurrence(edit.emptyValueOccurrenceId, edit.emptyValueNodeId, edit.fieldNodeId),
    materialization(edit),
  ];
  const first = mutations[0];
  if (first === undefined) {
    throw new Error("Typed Field clear contains no mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}

function configuredDatatype(
  fieldDefinitionId: string,
  available: ScopedProjection,
): Extract<FieldDefinitionConfiguration, { kind: "datatype" }> {
  const values = (available.fieldDefinitionConfigurations[fieldDefinitionId] ?? []).filter(
    (configuration): configuration is Extract<FieldDefinitionConfiguration, { kind: "datatype" }> =>
      configuration.kind === "datatype",
  );
  if (values.length !== 1) {
    throw new Error("Field Definition must have one unconflicted Datatype configuration");
  }
  const value = values[0];
  if (value === undefined) {
    throw new Error("Field Definition has no Datatype configuration");
  }
  return value;
}

function requireDatatype(
  actual: Extract<FieldDefinitionConfiguration, { kind: "datatype" }>,
  expected: string,
  label: string,
): void {
  if (actual.datatypeNodeId !== expected) {
    throw new Error(`Field Definition is not configured as ${label}`);
  }
}

function matchesSupertag(targetNodeId: string, sourceSupertagId: string, available: ScopedProjection): boolean {
  return (available.supertagApplications[targetNodeId] ?? []).some(
    (application) =>
      application.supertagId === sourceSupertagId ||
      (available.supertagInstanceSupertags[application.supertagId] ?? []).includes(sourceSupertagId),
  );
}

function fieldFor(edit: TypedFieldValueEdit, available: ScopedProjection): MaterializedField | undefined {
  return available.materializedFields[edit.ownerNodeId]?.find(
    (field) => field.fieldDefinitionId === edit.fieldDefinitionId,
  );
}

function singleValue(
  field: MaterializedField,
  available: ScopedProjection,
): Readonly<{ occurrenceId: string; nodeId: string }> {
  if (field.valueOccurrenceIds.length !== 1) {
    throw new Error("Typed single-value Field must contain exactly one value endpoint");
  }
  const occurrenceId = field.valueOccurrenceIds[0];
  if (occurrenceId === undefined) {
    throw new Error("Typed Field Value identity is absent");
  }
  const occurrence = available.occurrences[occurrenceId];
  if (occurrence === undefined || occurrence.parentNodeId !== field.fieldNodeId) {
    throw new Error("Typed Field Value is absent from the current Projection");
  }
  return { occurrenceId, nodeId: occurrence.nodeId };
}

function requireFieldIdentity(edit: TypedFieldValueEdit, field: MaterializedField): void {
  if (field.fieldNodeId !== edit.fieldNodeId || field.fieldOccurrenceId !== edit.fieldOccurrenceId) {
    throw new Error("Field identity does not match the materialized Field");
  }
}

function requireUnusedFieldIdentity(edit: TypedFieldValueEdit, available: ScopedProjection): void {
  requireUnusedNode(edit.fieldNodeId, available, "Field");
  requireUnusedOccurrence(edit.fieldOccurrenceId, available, "Field");
}

function requireActive(nodeId: string, available: ScopedProjection, label: string): void {
  if (nodeLocation(available.identity.workspaceNodeId, available, nodeId) !== "active") {
    throw new Error(`${label} is not an active Node`);
  }
}

function requireUnusedNode(nodeId: string, available: ScopedProjection, label: string): void {
  if (available.nodes[nodeId] !== undefined) {
    throw new Error(`${label} identity already exists`);
  }
}

function requireUnusedOccurrence(occurrenceId: string, available: ScopedProjection, label: string): void {
  if (available.occurrences[occurrenceId] !== undefined) {
    throw new Error(`${label} Occurrence identity already exists`);
  }
}

function materialization(edit: TypedFieldValueEdit): Mutation {
  return {
    kind: "field-materialize",
    ownerNodeId: edit.ownerNodeId,
    fieldDefinitionId: edit.fieldDefinitionId,
    fieldNodeId: edit.fieldNodeId,
    fieldOccurrenceId: edit.fieldOccurrenceId,
  };
}

function valueDeletion(edit: TypedFieldValueEdit, valueOccurrenceId: string): Mutation {
  return {
    kind: "field-value-delete",
    ownerNodeId: edit.ownerNodeId,
    fieldDefinitionId: edit.fieldDefinitionId,
    valueOccurrenceId,
  };
}

function occurrence(occurrenceId: string, nodeId: string, parentNodeId: string): Mutation {
  return { kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor: end };
}

function textSeed(value: string): NodeSeed {
  return { text: [{ value, attributes: {} }] };
}

function canonicalNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}
