import type { EditAction } from "../../../domain/edit/index.js";
import { addMetanodeReadScope, type GenerationReadScope } from "./read-scope.js";

export function addTemplateFieldEditReadScope(scope: GenerationReadScope, edit: EditAction): boolean {
  if (edit.kind === "supertag-template-field-create" || edit.kind === "supertag-template-field-add-existing") {
    scope.nodes.add(edit.supertagId);
    scope.nodes.add(edit.fieldDefinitionId);
    scope.childOccurrences.add(edit.supertagId);
    scope.supertags.add(edit.supertagId);
  } else if (
    edit.kind === "supertag-template-field-make-discoverable" ||
    edit.kind === "supertag-template-field-remove" ||
    edit.kind === "supertag-template-field-static-default-set" ||
    edit.kind === "supertag-template-field-visibility-set"
  ) {
    scope.nodes.add(edit.supertagId);
    scope.childOccurrences.add(edit.supertagId);
    scope.supertags.add(edit.supertagId);
  } else if (
    edit.kind === "supertag-optional-field-contribution-add" ||
    edit.kind === "supertag-optional-field-contribution-remove"
  ) {
    scope.nodes.add(edit.supertagId);
    scope.nodes.add(edit.fieldDefinitionId);
    addMetanodeReadScope(scope, edit.supertagId);
    scope.supertags.add(edit.supertagId);
  } else {
    return false;
  }
  return true;
}
