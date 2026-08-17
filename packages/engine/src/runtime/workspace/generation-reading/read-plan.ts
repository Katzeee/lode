import { expandEditMutation, mutationWriteMembers, type EditMutation } from "../../../domain/edit/index.js";
import { mutationRelations, type Mutation } from "../../../domain/fact/index.js";
import { addTypedFieldValueEditReadScope, isTypedFieldValueEdit } from "./typed-field-value-read-scope.js";
import { emptyGenerationReadScope, requiresOwnerGraph } from "./read-scope.js";
import { addSearchViewEditReadScope } from "./search-view-read-scope.js";
import { addTemplateFieldEditReadScope } from "./template-field-read-scope.js";

export type GenerationReadScope = Readonly<{
  nodes: Set<string>;
  occurrences: Set<string>;
  childOccurrences: Set<string>;
  supertags: Set<string>;
  instanceSupertags: Set<string>;
  fields: Set<string>;
}>;

export type GenerationReadPlan = Readonly<{
  mutations: readonly Mutation[];
  readsOwnerGraph: boolean;
  createScope: () => GenerationReadScope;
}>;

export function planMutationGenerationRead(mutations: readonly Mutation[]): GenerationReadPlan {
  return {
    mutations,
    readsOwnerGraph: mutations.some(requiresOwnerGraph),
    createScope: () => mutationReadScope(mutations),
  };
}

export function planEditGenerationRead(edits: readonly EditMutation[]): GenerationReadPlan {
  const mutations = editGenerationReadMutations(edits);
  return {
    mutations,
    readsOwnerGraph:
      mutations.some(requiresOwnerGraph) ||
      edits.some(
        (edit) =>
          edit.kind === "reference-promote" ||
          edit.kind === "node-delete" ||
          edit.kind === "node-restore" ||
          edit.kind === "shared-default-view-definition-remove" ||
          edit.kind === "shared-default-view-definition-options-update" ||
          edit.kind === "debug-node-open" ||
          edit.kind === "field-value-create" ||
          isTypedFieldValueEdit(edit) ||
          edit.kind === "url-node-create" ||
          edit.kind === "code-node-configure" ||
          edit.kind === "shared-default-view-definition-sort-by-name-create" ||
          edit.kind === "supertag-template-field-static-default-set",
      ),
    createScope: () => editReadScope(edits, mutations),
  };
}

function editGenerationReadMutations(edits: readonly EditMutation[]): Mutation[] {
  return edits.flatMap((edit) =>
    edit.kind === "node-delete"
      ? [edit]
      : edit.kind === "reference-promote" ||
          edit.kind === "node-restore" ||
          edit.kind === "supertag-application-create" ||
          edit.kind === "supertag-template-field-create" ||
          edit.kind === "supertag-template-field-add-existing" ||
          edit.kind === "supertag-template-field-make-discoverable" ||
          edit.kind === "supertag-template-field-remove" ||
          edit.kind === "supertag-template-field-static-default-set" ||
          edit.kind === "supertag-template-field-visibility-set" ||
          edit.kind === "supertag-optional-field-contribution-add" ||
          edit.kind === "inline-reference-alias-create" ||
          edit.kind === "search-expression-create" ||
          edit.kind === "search-expression-update" ||
          edit.kind === "shared-default-view-definition-create" ||
          edit.kind === "shared-default-view-definition-remove" ||
          edit.kind === "shared-default-view-definition-options-update" ||
          edit.kind === "field-datatype-configuration-create" ||
          edit.kind === "field-cardinality-configuration-create" ||
          edit.kind === "field-optionality-configuration-create" ||
          edit.kind === "field-initialization-expression-configuration-create" ||
          edit.kind === "field-datatype-configure" ||
          edit.kind === "field-cardinality-configure" ||
          edit.kind === "field-optionality-configure" ||
          edit.kind === "debug-node-open" ||
          edit.kind === "field-value-create" ||
          isTypedFieldValueEdit(edit) ||
          edit.kind === "url-node-create" ||
          edit.kind === "code-node-configure" ||
          edit.kind === "shared-default-view-definition-sort-by-name-create"
        ? []
        : mutationWriteMembers(expandEditMutation(edit)),
  );
}

function editReadScope(edits: readonly EditMutation[], mutations: readonly Mutation[]): GenerationReadScope {
  const scope = mutationReadScope(mutations);
  for (const edit of edits) {
    if (
      addBreadthEditReadScope(scope, edit) ||
      addTemplateFieldEditReadScope(scope, edit) ||
      addSearchViewEditReadScope(scope, edit)
    ) {
      continue;
    }
    if (edit.kind === "reference-promote") {
      scope.occurrences.add(edit.occurrenceId);
    } else if (edit.kind === "node-delete") {
      scope.nodes.add(edit.nodeId);
    } else if (edit.kind === "node-restore") {
      scope.nodes.add(edit.nodeId);
      scope.nodes.add(edit.ownerNodeId);
      scope.nodes.add(edit.parentNodeId);
      scope.occurrences.add(edit.occurrenceId);
    } else if (edit.kind === "supertag-application-create") {
      scope.nodes.add(edit.hostNodeId);
      scope.nodes.add(edit.metanodeId);
      scope.nodes.add(edit.supertagId);
      scope.nodes.add(edit.applicationNodeId);
      scope.occurrences.add(edit.applicationOccurrenceId);
      scope.occurrences.add(edit.relationDefinitionOccurrenceId);
      scope.occurrences.add(edit.definitionOccurrenceId);
      scope.childOccurrences.add(edit.metanodeId);
      scope.supertags.add(edit.supertagId);
    } else if (edit.kind === "inline-reference-alias-create") {
      scope.nodes.add(edit.hostNodeId);
      scope.nodes.add(edit.aliasNodeId);
    } else if (
      edit.kind === "field-datatype-configuration-create" ||
      edit.kind === "field-cardinality-configuration-create" ||
      edit.kind === "field-optionality-configuration-create" ||
      edit.kind === "field-initialization-expression-configuration-create"
    ) {
      scope.nodes.add(edit.fieldDefinitionId);
      scope.nodes.add(edit.configurationNodeId);
      if (edit.kind === "field-datatype-configuration-create" && edit.optionsSupertagId !== undefined) {
        scope.nodes.add(edit.optionsSupertagId);
        scope.supertags.add(edit.optionsSupertagId);
      }
      if (edit.kind === "field-initialization-expression-configuration-create") {
        scope.nodes.add(edit.expression.expressionNodeId);
        scope.nodes.add(edit.expression.sourceFieldDefinitionId);
        scope.nodes.add(edit.expression.contextNodeId);
        scope.childOccurrences.add(edit.expression.expressionNodeId);
      }
      scope.childOccurrences.add(edit.fieldDefinitionId);
    } else if (
      edit.kind === "field-datatype-configure" ||
      edit.kind === "field-cardinality-configure" ||
      edit.kind === "field-optionality-configure"
    ) {
      scope.nodes.add(edit.fieldDefinitionId);
      scope.nodes.add(edit.configurationNodeId);
      scope.nodes.add(
        edit.kind === "field-datatype-configure"
          ? edit.datatypeNodeId
          : edit.kind === "field-cardinality-configure"
            ? edit.cardinalityNodeId
            : edit.optionalityNodeId,
      );
      scope.occurrences.add(edit.configurationOccurrenceId);
      scope.occurrences.add(edit.valueOccurrenceId);
      scope.childOccurrences.add(edit.configurationNodeId);
      if (edit.kind === "field-datatype-configure" && edit.optionsSupertagId !== undefined) {
        scope.nodes.add(edit.optionsSupertagId);
        scope.supertags.add(edit.optionsSupertagId);
      }
    }
  }
  return scope;
}

function addBreadthEditReadScope(scope: GenerationReadScope, edit: EditMutation): boolean {
  if (addTypedFieldValueEditReadScope(scope, edit)) {
    return true;
  }
  if (edit.kind === "debug-node-open") {
    scope.nodes.add(edit.hostNodeId);
    scope.nodes.add(edit.metanodeId);
  } else if (edit.kind === "field-value-create") {
    scope.nodes.add(edit.ownerNodeId);
    scope.nodes.add(edit.fieldDefinitionId);
    scope.nodes.add(edit.fieldNodeId);
    scope.nodes.add(edit.valueNodeId);
    scope.occurrences.add(edit.fieldOccurrenceId);
    scope.occurrences.add(edit.valueOccurrenceId);
    scope.childOccurrences.add(edit.ownerNodeId);
    scope.childOccurrences.add(edit.fieldNodeId);
  } else if (edit.kind === "url-node-create") {
    scope.nodes.add(edit.parentNodeId);
    scope.nodes.add(edit.nodeId);
    scope.nodes.add(edit.urlFieldNodeId);
    scope.nodes.add(edit.urlValueNodeId);
    scope.occurrences.add(edit.occurrenceId);
    scope.occurrences.add(edit.urlFieldOccurrenceId);
    scope.occurrences.add(edit.urlValueOccurrenceId);
    scope.childOccurrences.add(edit.parentNodeId);
  } else if (edit.kind === "code-node-configure") {
    scope.nodes.add(edit.nodeId);
    scope.nodes.add(edit.languageFieldNodeId);
    scope.nodes.add(edit.languageValueNodeId);
    scope.occurrences.add(edit.languageFieldOccurrenceId);
    scope.occurrences.add(edit.languageValueOccurrenceId);
    scope.childOccurrences.add(edit.nodeId);
  } else if (edit.kind === "shared-default-view-definition-sort-by-name-create") {
    scope.nodes.add(edit.hostNodeId);
    scope.nodes.add(edit.viewDefinitionNodeId);
    scope.nodes.add(edit.sortOrderFieldNodeId);
    scope.nodes.add(edit.sortFieldNodeId);
    scope.occurrences.add(edit.sortOrderFieldOccurrenceId);
    scope.occurrences.add(edit.sortFieldOccurrenceId);
    scope.occurrences.add(edit.nodeNameOccurrenceId);
    scope.occurrences.add(edit.ascendingOccurrenceId);
    scope.childOccurrences.add(edit.hostNodeId);
    scope.childOccurrences.add(edit.viewDefinitionNodeId);
  } else {
    return false;
  }
  return true;
}

function mutationReadScope(mutations: readonly Mutation[]): GenerationReadScope {
  const scope = emptyGenerationReadScope();
  for (const mutation of mutations) {
    addRelations(scope, mutationRelations(mutation));
  }
  return scope;
}

function addRelations(scope: GenerationReadScope, relations: ReturnType<typeof mutationRelations>): void {
  relations.nodeIds.forEach((id) => scope.nodes.add(id));
  relations.occurrenceIds.forEach((id) => scope.occurrences.add(id));
  relations.childrenOfNodeIds.forEach((id) => scope.childOccurrences.add(id));
  relations.supertagIds.forEach((id) => {
    scope.supertags.add(id);
    scope.nodes.add(id);
  });
  relations.instanceSupertagIds.forEach((id) => scope.instanceSupertags.add(id));
  relations.fieldDefinitionIds.forEach((id) => {
    scope.fields.add(id);
    scope.nodes.add(id);
  });
}
