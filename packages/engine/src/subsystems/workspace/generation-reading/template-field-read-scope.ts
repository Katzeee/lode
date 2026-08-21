import type { EditMutation } from "../../../domain/edit/index.js";
import type { GenerationReadScope } from "./read-scope.js";

export function addTemplateFieldEditReadScope(scope: GenerationReadScope, edit: EditMutation): boolean {
  if (edit.kind === "supertag-template-field-create" || edit.kind === "supertag-template-field-add-existing") {
    scope.nodes.add(edit.supertagId);
    scope.nodes.add(edit.templateFieldNodeId);
    scope.nodes.add(edit.fieldDefinitionId);
    scope.nodes.add(edit.staticDefaultValueNodeId);
    scope.childOccurrences.add(edit.supertagId);
    scope.supertags.add(edit.supertagId);
  } else if (edit.kind === "supertag-template-field-make-discoverable") {
    scope.nodes.add(edit.supertagId);
    scope.nodes.add(edit.templateFieldNodeId);
    scope.nodes.add(edit.fieldDefinitionId);
    scope.supertags.add(edit.supertagId);
  } else if (edit.kind === "supertag-template-field-remove") {
    scope.nodes.add(edit.supertagId);
    scope.nodes.add(edit.templateFieldNodeId);
    scope.supertags.add(edit.supertagId);
  } else if (
    edit.kind === "supertag-template-field-static-default-set" ||
    edit.kind === "supertag-template-field-visibility-set"
  ) {
    scope.nodes.add(edit.supertagId);
    scope.nodes.add(edit.templateFieldNodeId);
    if (edit.kind === "supertag-template-field-static-default-set") {
      scope.childOccurrences.add(edit.templateFieldNodeId);
    }
    scope.supertags.add(edit.supertagId);
  } else if (edit.kind === "supertag-optional-field-contribution-add") {
    scope.nodes.add(edit.supertagId);
    scope.nodes.add(edit.metanodeId);
    scope.nodes.add(edit.fieldNurseryNodeId);
    scope.nodes.add(edit.fieldDefinitionId);
    scope.nodes.add(edit.contributionNodeId);
    scope.childOccurrences.add(edit.metanodeId);
    scope.childOccurrences.add(edit.fieldNurseryNodeId);
    scope.childOccurrences.add(edit.nurseryValueNodeId);
    scope.supertags.add(edit.supertagId);
  } else {
    return false;
  }
  return true;
}
