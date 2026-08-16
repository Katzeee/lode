import { expandEditMutation, mutationWriteMembers, type EditMutation } from "../../../domain/edit/index.js";
import { mutationRelations, type Mutation } from "../../../domain/fact/index.js";

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
  const mutations = edits.flatMap((edit) =>
    edit.kind === "reference-promote" ||
    edit.kind === "inline-reference-alias-create" ||
    edit.kind === "search-supertag-clause-create" ||
    edit.kind === "search-field-clause-create" ||
    edit.kind === "shared-default-view-definition-create" ||
    edit.kind === "field-datatype-configuration-create" ||
    edit.kind === "field-cardinality-configuration-create" ||
    edit.kind === "field-initialization-expression-configuration-create"
      ? []
      : mutationWriteMembers(expandEditMutation(edit)),
  );
  return {
    mutations,
    readsOwnerGraph: mutations.some(requiresOwnerGraph) || edits.some((edit) => edit.kind === "reference-promote"),
    createScope: () => {
      const scope = mutationReadScope(mutations);
      for (const edit of edits) {
        if (edit.kind === "reference-promote") {
          scope.occurrences.add(edit.occurrenceId);
        } else if (edit.kind === "inline-reference-alias-create") {
          scope.nodes.add(edit.hostNodeId);
          scope.nodes.add(edit.metanodeId);
          scope.nodes.add(edit.aliasNodeId);
          scope.childOccurrences.add(edit.metanodeId);
        } else if (edit.kind === "search-supertag-clause-create" || edit.kind === "search-field-clause-create") {
          scope.nodes.add(edit.searchNodeId);
          scope.nodes.add(edit.metanodeId);
          scope.nodes.add(edit.clauseNodeId);
          scope.nodes.add(edit.kind === "search-supertag-clause-create" ? edit.supertagId : edit.fieldDefinitionId);
          scope.childOccurrences.add(edit.metanodeId);
        } else if (edit.kind === "shared-default-view-definition-create") {
          scope.nodes.add(edit.hostNodeId);
          scope.nodes.add(edit.metanodeId);
          scope.nodes.add(edit.viewDefinitionNodeId);
          scope.childOccurrences.add(edit.metanodeId);
        } else if (
          edit.kind === "field-datatype-configuration-create" ||
          edit.kind === "field-cardinality-configuration-create" ||
          edit.kind === "field-initialization-expression-configuration-create"
        ) {
          scope.nodes.add(edit.fieldDefinitionId);
          scope.nodes.add(edit.metanodeId);
          scope.nodes.add(edit.configurationNodeId);
          if (edit.kind === "field-initialization-expression-configuration-create") {
            scope.nodes.add(edit.expression.sourceFieldDefinitionId);
          }
          scope.childOccurrences.add(edit.metanodeId);
        }
      }
      return scope;
    },
  };
}

function requiresOwnerGraph(mutation: Mutation): boolean {
  return (
    mutation.kind === "node-delete" ||
    mutation.kind === "node-owner-set" ||
    mutation.kind === "shared-default-view-definition-mode-set"
  );
}

function mutationReadScope(mutations: readonly Mutation[]): GenerationReadScope {
  const scope = emptyGenerationReadScope();
  for (const mutation of mutations) {
    addRelations(scope, mutationRelations(mutation));
  }
  return scope;
}

function emptyGenerationReadScope(): GenerationReadScope {
  return {
    nodes: new Set(),
    occurrences: new Set(),
    childOccurrences: new Set(),
    supertags: new Set(),
    instanceSupertags: new Set(),
    fields: new Set(),
  };
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
