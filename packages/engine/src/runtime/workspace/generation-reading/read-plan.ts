import {
  expandEditMutation,
  mutationWriteMembers,
  type EditMutation,
} from "../../../domain/edit/index.js";
import { mutationRelations, type Mutation } from "../../../domain/fact/index.js";
import { valueTargetAddress } from "../../../domain/reconcile/index.js";

export type GenerationReadScope = Readonly<{
  nodes: Set<string>;
  occurrences: Set<string>;
  children: Set<string>;
  values: Set<string>;
  schemas: Set<string>;
  instanceSchemas: Set<string>;
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
    readsOwnerGraph: mutations.some((mutation) => mutation.kind === "node-owner-set"),
    createScope: () => mutationReadScope(mutations),
  };
}

export function planEditGenerationRead(edits: readonly EditMutation[]): GenerationReadPlan {
  const mutations = edits.flatMap((edit) =>
    edit.kind === "reference-promote" ? [] : mutationWriteMembers(expandEditMutation(edit)),
  );
  return {
    mutations,
    readsOwnerGraph:
      mutations.some((mutation) => mutation.kind === "node-owner-set") ||
      edits.some((edit) => edit.kind === "reference-promote"),
    createScope: () => {
      const scope = mutationReadScope(mutations);
      for (const edit of edits) {
        if (edit.kind === "reference-promote") {
          scope.occurrences.add(edit.occurrenceId);
        }
      }
      return scope;
    },
  };
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
    children: new Set(),
    values: new Set(),
    schemas: new Set(),
    instanceSchemas: new Set(),
    fields: new Set(),
  };
}

function addRelations(
  scope: GenerationReadScope,
  relations: ReturnType<typeof mutationRelations>,
): void {
  relations.nodeIds.forEach((id) => scope.nodes.add(id));
  relations.occurrenceIds.forEach((id) => scope.occurrences.add(id));
  relations.childrenOfNodeIds.forEach((id) => scope.children.add(id));
  relations.schemaIds.forEach((id) => scope.schemas.add(id));
  relations.instanceSchemaIds.forEach((id) => scope.instanceSchemas.add(id));
  relations.fieldDefinitionIds.forEach((id) => scope.fields.add(id));
  relations.values.forEach(({ target, namespace }) =>
    scope.values.add(valueTargetAddress(target, namespace)),
  );
}
