import type { Mutation } from "../../domain/fact/index.js";
import { valueOwnerAddress, type Projection } from "../../domain/reconcile/index.js";

export type MutationReadScope = Readonly<{
  nodes: Set<string>;
  occurrences: Set<string>;
  children: Set<string>;
  values: Set<string>;
  schemas: Set<string>;
  instanceSchemas: Set<string>;
  fields: Set<string>;
}>;

export function mutationReadScope(mutations: readonly Mutation[]): MutationReadScope {
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
      addValueOwner(scope, mutation);
    }
  }
  return scope;
}

function addIdentityFields(scope: MutationReadScope, mutation: Mutation): void {
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
  if ("baseSchemaId" in mutation) {
    scope.nodes.add(mutation.baseSchemaId);
    scope.schemas.add(mutation.baseSchemaId);
  }
  if (mutation.kind === "field-materialize") {
    scope.nodes.add(mutation.ownerNodeId);
    scope.nodes.add(mutation.fieldNodeId);
    scope.occurrences.add(mutation.fieldOccurrenceId);
    scope.children.add(mutation.fieldOccurrenceId);
  }
  if ("occurrenceId" in mutation) {
    scope.occurrences.add(mutation.occurrenceId);
    scope.children.add(mutation.occurrenceId);
  }
  if ("parentOccurrenceId" in mutation) {
    addParent(scope, mutation.parentOccurrenceId);
  }
  if (
    "previousParentOccurrenceId" in mutation &&
    mutation.previousParentOccurrenceId !== undefined
  ) {
    addParent(scope, mutation.previousParentOccurrenceId);
  }
  if ("anchor" in mutation && mutation.kind !== "schema-field-add") {
    addAnchorEndpoints(scope.occurrences, mutation.anchor);
  }
  if ("previousAnchor" in mutation && mutation.previousAnchor !== undefined) {
    addAnchorEndpoints(scope.occurrences, mutation.previousAnchor);
  }
}

function addParent(scope: MutationReadScope, parent: string | null): void {
  scope.children.add(parent ?? "$root");
  if (parent !== null) {
    scope.occurrences.add(parent);
  }
}

function addValueOwner(
  scope: MutationReadScope,
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
): void {
  if (mutation.owner.kind === "node") {
    scope.nodes.add(mutation.owner.id);
  } else if (mutation.owner.kind === "occurrence") {
    scope.occurrences.add(mutation.owner.id);
  } else {
    scope.values.add(valueOwnerAddress(mutation.owner, mutation.namespace));
    (mutation.owner.kind === "schema" ? scope.schemas : scope.fields).add(mutation.owner.id);
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

export function isManagedChild(value: unknown): value is Projection["managedChildren"][number] {
  return (
    typeof value === "object" &&
    value !== null &&
    "parentNodeId" in value &&
    "schemaId" in value &&
    "fieldId" in value &&
    "nodeId" in value &&
    "occurrenceId" in value
  );
}

export function isProjectedOccurrence(value: unknown): value is Projection["occurrences"][string] {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeId" in value &&
    "parentOccurrenceId" in value
  );
}
