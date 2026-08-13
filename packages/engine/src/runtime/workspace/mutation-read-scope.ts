import type { Mutation } from "../../domain/fact/index.js";
import type { EditMutation } from "../../domain/edit/index.js";
import type { Projection } from "../../domain/reconcile/index.js";

export type MutationReadScope = Readonly<{
  nodes: Set<string>;
  occurrences: Set<string>;
  children: Set<string>;
  values: Set<string>;
  schemas: Set<string>;
  instanceSchemas: Set<string>;
  fields: Set<string>;
}>;

export function mutationReadScope(
  mutations: readonly (Mutation | EditMutation)[],
): MutationReadScope {
  const scope: MutationReadScope = {
    nodes: new Set(),
    occurrences: new Set(),
    children: new Set(),
    values: new Set(),
    schemas: new Set(),
    instanceSchemas: new Set(),
    fields: new Set(),
  };
  for (const mutation of mutations) {
    addIdentityFields(scope, mutation);
    if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
      addValueTarget(scope, mutation);
    }
  }
  return scope;
}

function addIdentityFields(scope: MutationReadScope, mutation: Mutation | EditMutation): void {
  if ("nodeId" in mutation) {
    scope.nodes.add(mutation.nodeId);
  }
  if ("schemaId" in mutation) {
    scope.nodes.add(mutation.schemaId);
    scope.schemas.add(mutation.schemaId);
  }
  if ("fieldDefinitionId" in mutation) {
    scope.nodes.add(mutation.fieldDefinitionId);
    scope.fields.add(mutation.fieldDefinitionId);
    if ("schemaId" in mutation) {
      scope.instanceSchemas.add(mutation.schemaId);
    }
  }
  if ("fieldNodeId" in mutation) {
    scope.nodes.add(mutation.fieldNodeId);
  }
  if ("fieldOccurrenceId" in mutation) {
    scope.occurrences.add(mutation.fieldOccurrenceId);
  }
  if ("baseSchemaId" in mutation) {
    scope.nodes.add(mutation.baseSchemaId);
    scope.schemas.add(mutation.baseSchemaId);
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    scope.instanceSchemas.add(mutation.schemaId);
    scope.instanceSchemas.add(mutation.baseSchemaId);
  }
  if ("templateNodeId" in mutation) {
    scope.nodes.add(mutation.templateNodeId);
  }
  if (mutation.kind === "template-node-detach") {
    scope.nodes.add(mutation.ownerNodeId);
    if ("sourceSchemaIds" in mutation) {
      mutation.sourceSchemaIds?.forEach((schemaId) => scope.schemas.add(schemaId));
    }
    if ("sourceApplicationSchemaIds" in mutation) {
      mutation.sourceApplicationSchemaIds?.forEach((schemaId) => {
        scope.schemas.add(schemaId);
        scope.instanceSchemas.add(schemaId);
      });
    }
  }
  if (mutation.kind === "node-owner-set") {
    scope.nodes.add(mutation.ownerNodeId);
    scope.children.add(mutation.ownerNodeId);
    if (mutation.previousOwnerNodeId !== undefined) {
      scope.nodes.add(mutation.previousOwnerNodeId);
      scope.children.add(mutation.previousOwnerNodeId);
    }
  }
  if (mutation.kind === "field-materialize") {
    scope.nodes.add(mutation.ownerNodeId);
    scope.nodes.add(mutation.fieldNodeId);
    scope.occurrences.add(mutation.fieldOccurrenceId);
    scope.children.add(mutation.fieldNodeId);
  }
  if (mutation.kind === "field-value-delete") {
    scope.nodes.add(mutation.ownerNodeId);
    scope.occurrences.add(mutation.valueOccurrenceId);
  }
  if (mutation.kind === "materialized-field-delete") {
    scope.nodes.add(mutation.ownerNodeId);
    scope.nodes.add(mutation.fieldNodeId);
    scope.occurrences.add(mutation.fieldOccurrenceId);
    scope.children.add(mutation.fieldNodeId);
  }
  if ("occurrenceId" in mutation) {
    scope.occurrences.add(mutation.occurrenceId);
  }
  if ("parentNodeId" in mutation) {
    addParent(scope, mutation.parentNodeId);
  }
  if ("previousParentNodeId" in mutation && mutation.previousParentNodeId !== undefined) {
    addParent(scope, mutation.previousParentNodeId);
  }
  if ("anchor" in mutation) {
    addAnchorEndpoints(scope.occurrences, mutation.anchor);
  }
  if ("previousAnchor" in mutation && mutation.previousAnchor !== undefined) {
    addAnchorEndpoints(scope.occurrences, mutation.previousAnchor);
  }
}

function addParent(scope: MutationReadScope, parent: string): void {
  scope.nodes.add(parent);
  scope.children.add(parent);
}

function addValueTarget(
  scope: MutationReadScope,
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
): void {
  if (mutation.target.kind === "node") {
    scope.nodes.add(mutation.target.id);
  } else {
    scope.occurrences.add(mutation.target.id);
  }
}

function addAnchorEndpoints(
  occurrences: Set<string>,
  anchor: Readonly<{ after: string | null; before: string | null }>,
): void {
  if (anchor.after) {
    occurrences.add(anchor.after);
  }
  if (anchor.before) {
    occurrences.add(anchor.before);
  }
}

export function isProjectedOccurrence(value: unknown): value is Projection["occurrences"][string] {
  return (
    typeof value === "object" && value !== null && "nodeId" in value && "parentNodeId" in value
  );
}

export function isTemplateNodeInstance(
  value: unknown,
): value is Projection["templateNodeInstances"][number] {
  return (
    typeof value === "object" &&
    value !== null &&
    "ownerNodeId" in value &&
    "templateNodeId" in value &&
    "instanceOccurrenceId" in value &&
    "state" in value
  );
}
