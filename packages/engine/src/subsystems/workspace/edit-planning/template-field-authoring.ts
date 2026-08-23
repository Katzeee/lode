import type { EditAction } from "../../../domain/edit/index.js";
import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  workspaceSchemaNodeId,
  type FactActionId,
} from "../../../domain/fact/index.js";
import type { ScopedProjection, TemplateField } from "../../../domain/reconcile/index.js";
import { singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";

export function prepareSupertagTemplateFieldCreation(
  edit: Extract<EditAction, { kind: "supertag-template-field-create" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  assertSupertag(available, edit.supertagId);
  if (available.nodes[edit.fieldDefinitionId] !== undefined) {
    throw new Error("Field Definition identity already exists");
  }
  assertFieldDefinitionIsNotExposed(available, edit.supertagId, edit.fieldDefinitionId);
  return singleAuthoredActionBatch({
    kind: "template-field-add",
    supertagId: edit.supertagId,
    fieldDefinition: {
      kind: "new",
      fieldDefinitionId: edit.fieldDefinitionId,
      ...(edit.fieldDefinitionSeed === undefined ? {} : { seed: edit.fieldDefinitionSeed }),
    },
    anchor: edit.anchor,
  });
}

export function prepareExistingSupertagTemplateFieldAddition(
  edit: Extract<EditAction, { kind: "supertag-template-field-add-existing" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  assertSupertag(available, edit.supertagId);
  if (
    available.nodes[edit.fieldDefinitionId]?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
    available.nodeOwners[edit.fieldDefinitionId] !== workspaceSchemaNodeId(available.identity.workspaceNodeId)
  ) {
    throw new Error("Template Field endpoint is not a discoverable Field Definition");
  }
  assertFieldDefinitionIsNotExposed(available, edit.supertagId, edit.fieldDefinitionId);
  return singleAuthoredActionBatch({
    kind: "template-field-add",
    supertagId: edit.supertagId,
    fieldDefinition: { kind: "existing", fieldDefinitionId: edit.fieldDefinitionId },
    anchor: edit.anchor,
  });
}

export function prepareSupertagTemplateFieldDiscoverability(
  edit: Extract<EditAction, { kind: "supertag-template-field-make-discoverable" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  const field = requireTemplateField(available, edit.supertagId, edit.templateFieldId);
  if (field.fieldDefinitionOwner !== "template-field") {
    throw new Error("Template Field Definition is already discoverable");
  }
  return singleAuthoredActionBatch({
    kind: "field-definition-make-discoverable",
    fieldDefinitionId: field.fieldDefinitionId,
  });
}

export function prepareSupertagTemplateFieldRemoval(
  edit: Extract<EditAction, { kind: "supertag-template-field-remove" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  const field = requireTemplateField(available, edit.supertagId, edit.templateFieldId);
  return singleAuthoredActionBatch({
    kind: "template-field-remove",
    supertagId: field.supertagId,
    fieldDefinitionId: field.fieldDefinitionId,
  });
}

export function prepareSupertagTemplateFieldVisibility(
  edit: Extract<EditAction, { kind: "supertag-template-field-visibility-set" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  const field = requireTemplateField(available, edit.supertagId, edit.templateFieldId);
  if (field.visibility === edit.visibility && !field.visibilityConflicted) {
    throw new Error("Template Field already has this visibility");
  }
  return singleAuthoredActionBatch({
    kind: "template-field-visibility-set",
    templateFieldId: edit.templateFieldId,
    visibility: edit.visibility,
  });
}

export function prepareSupertagTemplateFieldStaticDefault(
  edit: Extract<EditAction, { kind: "supertag-template-field-static-default-set" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  const field = requireTemplateField(available, edit.supertagId, edit.templateFieldId);
  if (
    !field.staticDefaultConflicted &&
    new Set(field.staticDefaultCandidates.map((candidate) => candidate.value)).size === 1 &&
    field.staticDefaultCandidates[0]?.value === edit.value
  ) {
    throw new Error("Template Field already has this Static Default");
  }
  return singleAuthoredActionBatch({
    kind: "template-field-static-default-set",
    templateFieldId: edit.templateFieldId,
    value: edit.value,
  });
}

function requireTemplateField(
  available: ScopedProjection,
  supertagId: string,
  templateFieldId: FactActionId,
): TemplateField {
  const field = (available.templateFields[supertagId] ?? []).find(
    (candidate) => candidate.factActionId === templateFieldId,
  );
  if (field === undefined) {
    throw new Error("Template Field is absent from the observed projection");
  }
  return field;
}

function assertSupertag(available: ScopedProjection, supertagId: string): void {
  if (available.nodes[supertagId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE) {
    throw new Error("Template Field host is not an active Supertag Definition");
  }
}

function assertFieldDefinitionIsNotExposed(
  available: ScopedProjection,
  supertagId: string,
  fieldDefinitionId: string,
): void {
  if (
    (available.templateFields[supertagId] ?? []).some((field) => field.fieldDefinitionId === fieldDefinitionId) ||
    (available.optionalFieldContributions[supertagId] ?? []).some(
      (field) => field.fieldDefinitionId === fieldDefinitionId,
    )
  ) {
    throw new Error("Supertag already exposes this Field Definition");
  }
}
