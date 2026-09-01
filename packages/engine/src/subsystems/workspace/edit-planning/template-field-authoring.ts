import type { EditAction } from "../../../domain/edit/index.js";
import type { FactActionId } from "../../../domain/fact/index.js";
import type { InterpretedProjection, TemplateField } from "../../../domain/reconcile/index.js";
import { singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import { EditPlanningRejection } from "./planning-rejection.js";

export function prepareSupertagTemplateFieldDiscoverability(
  edit: Extract<EditAction, { kind: "supertag-template-field-make-discoverable" }>,
  available: InterpretedProjection,
): AuthoredActionBatch {
  const field = requireTemplateField(available, edit.supertagId, edit.templateFieldId);
  if (field.fieldDefinitionOwner !== "template-field") {
    throw new EditPlanningRejection("Template Field Definition is already discoverable");
  }
  return singleAuthoredActionBatch({
    kind: "field-definition-make-discoverable",
    fieldDefinitionId: field.fieldDefinitionId,
  });
}

export function prepareSupertagTemplateFieldRemoval(
  edit: Extract<EditAction, { kind: "supertag-template-field-remove" }>,
  available: InterpretedProjection,
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
  available: InterpretedProjection,
): AuthoredActionBatch {
  const field = findTemplateField(available, edit.supertagId, edit.templateFieldId);
  if (field !== undefined && field.visibility === edit.visibility && !field.visibilityConflicted) {
    throw new EditPlanningRejection("Template Field already has this visibility");
  }
  return singleAuthoredActionBatch({
    kind: "template-field-visibility-set",
    templateFieldId: edit.templateFieldId,
    visibility: edit.visibility,
  });
}

export function prepareSupertagTemplateFieldStaticDefault(
  edit: Extract<EditAction, { kind: "supertag-template-field-static-default-set" }>,
  available: InterpretedProjection,
): AuthoredActionBatch {
  const field = findTemplateField(available, edit.supertagId, edit.templateFieldId);
  if (
    field !== undefined &&
    !field.staticDefaultConflicted &&
    new Set(field.staticDefaultCandidates.map((candidate) => candidate.value)).size === 1 &&
    field.staticDefaultCandidates[0]?.value === edit.value
  ) {
    throw new EditPlanningRejection("Template Field already has this Static Default");
  }
  return singleAuthoredActionBatch({
    kind: "template-field-static-default-set",
    templateFieldId: edit.templateFieldId,
    value: edit.value,
  });
}

function requireTemplateField(
  available: InterpretedProjection,
  supertagId: string,
  templateFieldId: FactActionId,
): TemplateField {
  const field = findTemplateField(available, supertagId, templateFieldId);
  if (field === undefined) {
    throw new EditPlanningRejection("Template Field is absent from the observed projection");
  }
  return field;
}

function findTemplateField(
  available: InterpretedProjection,
  supertagId: string,
  templateFieldId: FactActionId,
): TemplateField | undefined {
  return (available.templateFields[supertagId] ?? []).find((candidate) => candidate.factActionId === templateFieldId);
}
