import type { EditMutation } from "../../../domain/edit/index.js";
import { CHECKBOX_VALUE_NODE_IDS } from "../../../domain/fact/index.js";
import type { GenerationReadScope } from "./read-plan.js";

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

export function isTypedFieldValueEdit(edit: EditMutation): edit is TypedFieldValueEdit {
  return (
    edit.kind === "field-number-value-set" ||
    edit.kind === "field-date-value-set" ||
    edit.kind === "field-checkbox-value-set" ||
    edit.kind === "field-options-from-supertag-value-set" ||
    edit.kind === "typed-field-value-clear"
  );
}

export function addTypedFieldValueEditReadScope(scope: GenerationReadScope, edit: EditMutation): boolean {
  if (!isTypedFieldValueEdit(edit)) {
    return false;
  }
  scope.nodes.add(edit.ownerNodeId);
  scope.nodes.add(edit.fieldDefinitionId);
  scope.nodes.add(edit.fieldNodeId);
  scope.occurrences.add(edit.fieldOccurrenceId);
  scope.childOccurrences.add(edit.ownerNodeId);
  scope.childOccurrences.add(edit.fieldNodeId);
  scope.fields.add(edit.fieldDefinitionId);
  if (edit.kind === "field-number-value-set" || edit.kind === "field-date-value-set") {
    scope.nodes.add(edit.valueNodeId);
    scope.occurrences.add(edit.valueOccurrenceId);
  } else if (edit.kind === "field-options-from-supertag-value-set") {
    scope.nodes.add(edit.targetNodeId);
    scope.occurrences.add(edit.valueOccurrenceId);
  } else if (edit.kind === "field-checkbox-value-set") {
    scope.nodes.add(edit.value ? CHECKBOX_VALUE_NODE_IDS.yes : CHECKBOX_VALUE_NODE_IDS.no);
    scope.occurrences.add(edit.valueOccurrenceId);
  } else {
    if (edit.emptyValueNodeId !== undefined) {
      scope.nodes.add(edit.emptyValueNodeId);
    }
    if (edit.emptyValueOccurrenceId !== undefined) {
      scope.occurrences.add(edit.emptyValueOccurrenceId);
    }
  }
  return true;
}
