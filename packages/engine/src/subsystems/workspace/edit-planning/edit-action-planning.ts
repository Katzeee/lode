import { expandEditAction, hasRegistryPlan, planRegistryEdit, type EditAction } from "../../../domain/edit/index.js";
import type { FactActionId } from "../../../domain/fact/index.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";
import type { AuthoredActionBatch } from "./action-batch.js";
import { expandBreadthEdit } from "./breadth-edit-expansion.js";
import { prepareSearchExpressionCreation, prepareSearchExpressionEdit } from "./search-expression-planning.js";
import { isStructuralEdit, prepareStructuralEdit } from "./structural-edit-planning.js";
import { prepareSupertagApplicationCreation } from "./supertag-application-planning.js";
import {
  prepareSupertagTemplateFieldDiscoverability,
  prepareSupertagTemplateFieldRemoval,
  prepareSupertagTemplateFieldStaticDefault,
  prepareSupertagTemplateFieldVisibility,
} from "./template-field-authoring.js";
import { prepareTypedFieldValue } from "./typed-field-value.js";
import { prepareViewEdit } from "./view-planning.js";

export function planEditAction(
  edit: EditAction,
  available: InterpretedProjection,
  finalActionId: (actionIndex: number) => FactActionId,
): AuthoredActionBatch {
  if (hasRegistryPlan(edit)) {
    return planRegistryEdit(edit);
  }
  if (isStructuralEdit(edit)) {
    return prepareStructuralEdit(edit, available);
  }
  if (
    edit.kind === "field-number-value-set" ||
    edit.kind === "field-date-value-set" ||
    edit.kind === "field-checkbox-value-set" ||
    edit.kind === "field-options-from-supertag-value-set" ||
    edit.kind === "typed-field-value-clear"
  ) {
    return prepareTypedFieldValue(edit, available);
  }
  if (edit.kind === "field-value-create" || edit.kind === "url-node-create" || edit.kind === "code-node-configure") {
    return expandBreadthEdit(edit, available);
  }
  if (edit.kind === "supertag-application-create") {
    return prepareSupertagApplicationCreation(edit, available);
  }
  if (edit.kind === "supertag-template-field-make-discoverable") {
    return prepareSupertagTemplateFieldDiscoverability(edit, available);
  }
  if (edit.kind === "supertag-template-field-remove") {
    return prepareSupertagTemplateFieldRemoval(edit, available);
  }
  if (edit.kind === "supertag-template-field-static-default-set") {
    return prepareSupertagTemplateFieldStaticDefault(edit, available);
  }
  if (edit.kind === "supertag-template-field-visibility-set") {
    return prepareSupertagTemplateFieldVisibility(edit, available);
  }
  if (edit.kind === "search-expression-create") {
    return prepareSearchExpressionCreation(edit, available, finalActionId);
  }
  if (
    edit.kind === "search-expression-add" ||
    edit.kind === "search-expression-configure" ||
    edit.kind === "search-expression-move" ||
    edit.kind === "search-expression-remove"
  ) {
    return prepareSearchExpressionEdit(edit, available, finalActionId);
  }
  if (isViewEdit(edit)) {
    return prepareViewEdit(edit, available, finalActionId);
  }
  return expandEditAction(edit);
}

function isViewEdit(edit: EditAction): edit is Parameters<typeof prepareViewEdit>[0] {
  return (
    edit.kind === "shared-default-view-create" ||
    edit.kind === "shared-default-view-remove" ||
    edit.kind.startsWith("view-")
  );
}
