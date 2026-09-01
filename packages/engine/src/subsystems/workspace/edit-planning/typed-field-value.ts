import type { EditAction } from "../../../domain/edit/index.js";
import { authoredActionBatch, requireAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import {
  CHECKBOX_VALUE_NODE_IDS,
  END_SEQUENCE_ANCHOR as end,
  FIELD_DATATYPE_NODE_IDS,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  type GraphAction,
} from "../../../domain/fact/index.js";
import {
  textAtoms,
  type FieldDefinitionConfiguration,
  type MaterializedField,
  type InterpretedProjection,
} from "../../../domain/reconcile/index.js";
import { EditPlanningRejection } from "./planning-rejection.js";
import {
  materializedFieldFor,
  requireActiveNode,
  requireUnusedNode,
  requireUnusedOccurrence,
  textSeed,
} from "./projection-guards.js";

type TypedFieldValueEdit = Extract<
  EditAction,
  {
    kind:
      | "field-number-value-set"
      | "field-date-value-set"
      | "field-checkbox-value-set"
      | "field-options-from-supertag-value-set"
      | "typed-field-value-clear";
  }
>;

export function prepareTypedFieldValue(
  edit: TypedFieldValueEdit,
  available: InterpretedProjection,
): AuthoredActionBatch {
  requireActiveNode(edit.ownerNodeId, available, "Field owner");
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
      throw new EditPlanningRejection("Options target does not match the configured Supertag");
    }
    return setReferenceValue(edit, edit.targetNodeId, available);
  }
  return clearTypedFieldValue(edit, datatype, available);
}

function setOwnedTextValue(
  edit: Extract<TypedFieldValueEdit, { kind: "field-number-value-set" | "field-date-value-set" }>,
  value: string,
  available: InterpretedProjection,
): AuthoredActionBatch {
  const field = fieldFor(edit, available);
  const fieldNodeId = materializedFieldNodeId(edit.ownerNodeId, edit.fieldDefinitionId);
  if (field === undefined) {
    requireUnusedFieldIdentity(edit, available);
    requireUnusedNode(edit.valueNodeId, available, "Field Value");
    requireUnusedOccurrence(edit.valueOccurrenceId, available, "Field Value");
    return authoredActionBatch([
      materialization(edit),
      {
        kind: "node-create",
        nodeId: edit.valueNodeId,
        ownerNodeId: fieldNodeId,
        originalPlacement: { placementId: edit.valueOccurrenceId, anchor: end },
        seed: textSeed(value),
      },
    ]);
  }
  const current = singleValue(field, available);
  if (current.occurrenceId !== edit.valueOccurrenceId || current.nodeId !== edit.valueNodeId) {
    throw new EditPlanningRejection("Typed Field Value identity does not match the materialized value");
  }
  if (available.nodeOwners[current.nodeId] !== field.fieldNodeId) {
    throw new EditPlanningRejection("Number and Date values must be owned by their Field");
  }
  const node = available.nodes[current.nodeId];
  if (node === undefined || node.content.some((item) => item.kind !== "text")) {
    throw new EditPlanningRejection("Number and Date values must contain text only");
  }
  return authoredActionBatch([
    {
      kind: "rich-text-splice",
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
  available: InterpretedProjection,
): AuthoredActionBatch {
  requireActiveNode(targetNodeId, available, "Typed Field target");
  const field = fieldFor(edit, available);
  const fieldNodeId = materializedFieldNodeId(edit.ownerNodeId, edit.fieldDefinitionId);
  if (field === undefined) {
    requireUnusedFieldIdentity(edit, available);
    requireUnusedOccurrence(edit.valueOccurrenceId, available, "Field Value");
    return authoredActionBatch([materialization(edit), occurrence(edit.valueOccurrenceId, targetNodeId, fieldNodeId)]);
  }
  const current = singleValue(field, available);
  if (current.nodeId === targetNodeId) {
    throw new EditPlanningRejection("Typed Field already has the requested value");
  }
  requireUnusedOccurrence(edit.valueOccurrenceId, available, "Field Value");
  return authoredActionBatch([
    valueDeletion(current.occurrenceId),
    occurrence(edit.valueOccurrenceId, targetNodeId, fieldNodeId),
    materialization(edit),
  ]);
}

function clearTypedFieldValue(
  edit: Extract<TypedFieldValueEdit, { kind: "typed-field-value-clear" }>,
  datatype: Extract<FieldDefinitionConfiguration, { kind: "datatype" }>,
  available: InterpretedProjection,
): AuthoredActionBatch {
  if (
    datatype.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.number &&
    datatype.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.date &&
    datatype.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.checkbox &&
    datatype.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.optionsFromSupertag
  ) {
    throw new EditPlanningRejection("Field Datatype does not support typed clear");
  }
  const field = fieldFor(edit, available);
  if (field === undefined) {
    throw new EditPlanningRejection("Typed Field is already unset");
  }
  if (datatype.datatypeNodeId === FIELD_DATATYPE_NODE_IDS.checkbox) {
    if (edit.emptyValueNodeId !== undefined || edit.emptyValueOccurrenceId !== undefined) {
      throw new EditPlanningRejection("Checkbox clear removes the Field and does not accept placeholder identities");
    }
    return authoredActionBatch([
      {
        kind: "materialized-field-clear",
        ownerNodeId: edit.ownerNodeId,
        fieldDefinitionId: edit.fieldDefinitionId,
      },
    ]);
  }
  if (edit.emptyValueNodeId === undefined || edit.emptyValueOccurrenceId === undefined) {
    throw new EditPlanningRejection("Typed Field clear requires fresh empty value identities");
  }
  requireUnusedNode(edit.emptyValueNodeId, available, "Empty Field Value");
  requireUnusedOccurrence(edit.emptyValueOccurrenceId, available, "Empty Field Value");
  const current = field.valueOccurrenceIds.length === 0 ? null : singleValue(field, available);
  if (
    current !== null &&
    available.nodeOwners[current.nodeId] === field.fieldNodeId &&
    textAtoms(available.nodes[current.nodeId]).length === 0
  ) {
    throw new EditPlanningRejection("Typed Field is already empty");
  }
  const actions: GraphAction[] = [
    ...(current === null ? [] : [valueDeletion(current.occurrenceId)]),
    {
      kind: "node-create",
      nodeId: edit.emptyValueNodeId,
      ownerNodeId: materializedFieldNodeId(edit.ownerNodeId, edit.fieldDefinitionId),
      originalPlacement: { placementId: edit.emptyValueOccurrenceId, anchor: end },
    },
    materialization(edit),
  ];
  return requireAuthoredActionBatch(actions);
}

function configuredDatatype(
  fieldDefinitionId: string,
  available: InterpretedProjection,
): Extract<FieldDefinitionConfiguration, { kind: "datatype" }> {
  const values = (available.fieldDefinitionConfigurations[fieldDefinitionId] ?? []).filter(
    (configuration): configuration is Extract<FieldDefinitionConfiguration, { kind: "datatype" }> =>
      configuration.kind === "datatype",
  );
  if (values.length !== 1) {
    throw new EditPlanningRejection("Field Definition must have one unconflicted Datatype configuration");
  }
  const value = values[0];
  if (value === undefined) {
    throw new EditPlanningRejection("Field Definition has no Datatype configuration");
  }
  return value;
}

function requireDatatype(
  actual: Extract<FieldDefinitionConfiguration, { kind: "datatype" }>,
  expected: string,
  label: string,
): void {
  if (actual.datatypeNodeId !== expected) {
    throw new EditPlanningRejection(`Field Definition is not configured as ${label}`);
  }
}

function matchesSupertag(targetNodeId: string, sourceSupertagId: string, available: InterpretedProjection): boolean {
  return (available.supertagApplications[targetNodeId] ?? []).some(
    (application) =>
      application.supertagId === sourceSupertagId ||
      (available.supertagInstanceSupertags[application.supertagId] ?? []).includes(sourceSupertagId),
  );
}

function fieldFor(edit: TypedFieldValueEdit, available: InterpretedProjection): MaterializedField | undefined {
  return materializedFieldFor(available, edit.ownerNodeId, edit.fieldDefinitionId);
}

function singleValue(
  field: MaterializedField,
  available: InterpretedProjection,
): Readonly<{ occurrenceId: string; nodeId: string }> {
  if (field.valueOccurrenceIds.length !== 1) {
    throw new EditPlanningRejection("Typed single-value Field must contain exactly one value endpoint");
  }
  const occurrenceId = field.valueOccurrenceIds[0];
  if (occurrenceId === undefined) {
    throw new EditPlanningRejection("Typed Field Value identity is absent");
  }
  const occurrence = available.occurrences[occurrenceId];
  if (occurrence === undefined || occurrence.parentNodeId !== field.fieldNodeId) {
    throw new EditPlanningRejection("Typed Field Value is absent from the current Projection");
  }
  return { occurrenceId, nodeId: occurrence.nodeId };
}

function requireUnusedFieldIdentity(edit: TypedFieldValueEdit, available: InterpretedProjection): void {
  requireUnusedNode(materializedFieldNodeId(edit.ownerNodeId, edit.fieldDefinitionId), available, "Field");
  requireUnusedOccurrence(materializedFieldOccurrenceId(edit.ownerNodeId, edit.fieldDefinitionId), available, "Field");
}

function materialization(edit: TypedFieldValueEdit): GraphAction {
  return {
    kind: "field-materialize",
    ownerNodeId: edit.ownerNodeId,
    fieldDefinitionId: edit.fieldDefinitionId,
  };
}

function valueDeletion(valueOccurrenceId: string): GraphAction {
  return {
    kind: "field-value-remove",
    valuePlacementId: valueOccurrenceId,
  };
}

function occurrence(occurrenceId: string, nodeId: string, parentNodeId: string): GraphAction {
  return { kind: "placement-create", placementId: occurrenceId, nodeId, parentNodeId, anchor: end };
}

function canonicalNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}
