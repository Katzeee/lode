import type { ContributionFact, Fact, Mutation, TextAtomId } from "../fact/index.js";
import { valueOwnerAddress, type Projection } from "../reconcile/index.js";

type HistoryScope = {
  nodes: Set<string>;
  occurrences: Set<string>;
  schemas: Set<string>;
  fields: Set<string>;
  valueOwners: Set<string>;
  factIds: Set<string>;
};

export function scopedHistoryFacts(
  facts: readonly Fact[],
  targets: readonly ContributionFact[],
  projection: Projection,
): readonly Fact[] {
  const scope = emptyScope();
  const selected = new Set(targets.map((target) => target.id));
  targets.forEach((target) => addMutation(scope, target.body.mutation));
  addTemplateScope(scope, projection);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of facts) {
      if (selected.has(fact.id)) {
        continue;
      }
      if (fact.body.kind === "resolution") {
        if (fact.body.proposalContributionIds.some((target) => selected.has(target))) {
          selected.add(fact.id);
          changed = true;
        }
        continue;
      }
      if (fact.body.kind === "maintenance") {
        continue;
      }
      if (scope.factIds.has(fact.id) || mutationTouches(scope, fact.body.mutation)) {
        selected.add(fact.id);
        addMutation(scope, fact.body.mutation);
        addTemplateScope(scope, projection);
        changed = true;
      }
    }
  }
  return facts.filter((fact) => selected.has(fact.id));
}

function emptyScope(): HistoryScope {
  return {
    nodes: new Set(),
    occurrences: new Set(),
    schemas: new Set(),
    fields: new Set(),
    valueOwners: new Set(),
    factIds: new Set(),
  };
}

function addTemplateScope(scope: HistoryScope, projection: Projection): void {
  for (const instance of projection.templateNodeInstances) {
    if (
      scope.nodes.has(instance.ownerNodeId) ||
      scope.nodes.has(instance.templateNodeId) ||
      (instance.instanceNodeId !== null && scope.nodes.has(instance.instanceNodeId)) ||
      scope.occurrences.has(instance.instanceOccurrenceId) ||
      instance.sources.some((source) => scope.schemas.has(source.schemaId))
    ) {
      scope.nodes.add(instance.ownerNodeId);
      scope.nodes.add(instance.templateNodeId);
      if (instance.instanceNodeId !== null) {
        scope.nodes.add(instance.instanceNodeId);
      }
      scope.occurrences.add(instance.instanceOccurrenceId);
      instance.sources.forEach((source) => scope.schemas.add(source.schemaId));
    }
  }
}

function addMutation(scope: HistoryScope, mutation: Mutation): void {
  if ("nodeId" in mutation) {
    scope.nodes.add(mutation.nodeId);
  }
  if ("occurrenceId" in mutation) {
    scope.occurrences.add(mutation.occurrenceId);
  }
  if ("parentOccurrenceId" in mutation && mutation.parentOccurrenceId !== null) {
    scope.occurrences.add(mutation.parentOccurrenceId);
  }
  if (
    "previousParentOccurrenceId" in mutation &&
    mutation.previousParentOccurrenceId !== undefined &&
    mutation.previousParentOccurrenceId !== null
  ) {
    scope.occurrences.add(mutation.previousParentOccurrenceId);
  }
  if ("anchor" in mutation) {
    addAnchor(scope, mutation.anchor);
  }
  if ("previousAnchor" in mutation && mutation.previousAnchor !== undefined) {
    addAnchor(scope, mutation.previousAnchor);
  }
  if (isSchemaRelation(mutation)) {
    scope.schemas.add(mutation.schemaId);
    scope.nodes.add(mutation.schemaId);
    if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
      scope.nodes.add(mutation.nodeId);
    } else if (
      mutation.kind === "schema-extension-add" ||
      mutation.kind === "schema-extension-remove"
    ) {
      scope.schemas.add(mutation.baseSchemaId);
      scope.nodes.add(mutation.baseSchemaId);
    } else if (
      mutation.kind === "schema-template-node-add" ||
      mutation.kind === "schema-template-node-remove"
    ) {
      scope.nodes.add(mutation.templateNodeId);
    } else {
      scope.fields.add(mutation.fieldDefinitionId);
      scope.nodes.add(mutation.fieldDefinitionId);
    }
  }
  if (mutation.kind === "template-node-detach") {
    scope.nodes.add(mutation.ownerNodeId);
    scope.nodes.add(mutation.templateNodeId);
    mutation.sourceSchemaIds?.forEach((schemaId) => scope.schemas.add(schemaId));
  }
  if (
    mutation.kind === "field-materialize" ||
    mutation.kind === "field-initialize" ||
    mutation.kind === "field-value-delete" ||
    mutation.kind === "materialized-field-delete"
  ) {
    scope.nodes.add(mutation.ownerNodeId);
    scope.fields.add(mutation.fieldDefinitionId);
    if (mutation.kind === "field-initialize") {
      scope.schemas.add(mutation.schemaId);
    } else if (
      mutation.kind === "field-materialize" ||
      mutation.kind === "materialized-field-delete"
    ) {
      scope.nodes.add(mutation.fieldNodeId);
      scope.occurrences.add(mutation.fieldOccurrenceId);
    } else {
      scope.occurrences.add(mutation.valueOccurrenceId);
    }
  }
  if (mutation.kind === "text-splice") {
    mutation.deleteAtomIds.forEach((id) => scope.factIds.add(atomContributionId(id)));
  }
  if (mutation.kind === "text-mark") {
    mutation.atomIds.forEach((id) => scope.factIds.add(atomContributionId(id)));
  }
  if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
    scope.valueOwners.add(valueOwnerAddress(mutation.owner, mutation.namespace));
    if (mutation.owner.kind === "node") {
      scope.nodes.add(mutation.owner.id);
    } else if (mutation.owner.kind === "occurrence") {
      scope.occurrences.add(mutation.owner.id);
    } else if (mutation.owner.kind === "schema") {
      scope.schemas.add(mutation.owner.id);
    } else {
      scope.fields.add(mutation.owner.id);
    }
  }
}

function mutationTouches(scope: HistoryScope, mutation: Mutation): boolean {
  if ("nodeId" in mutation && scope.nodes.has(mutation.nodeId)) {
    return true;
  }
  if ("occurrenceId" in mutation && scope.occurrences.has(mutation.occurrenceId)) {
    return true;
  }
  if (mutation.kind === "occurrence-create" && scope.nodes.has(mutation.nodeId)) {
    return true;
  }
  if (isSchemaRelation(mutation)) {
    return (
      scope.schemas.has(mutation.schemaId) ||
      (mutation.kind === "schema-apply" || mutation.kind === "schema-remove"
        ? scope.nodes.has(mutation.nodeId)
        : mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove"
          ? scope.schemas.has(mutation.baseSchemaId)
          : mutation.kind === "schema-template-node-add" ||
              mutation.kind === "schema-template-node-remove"
            ? scope.nodes.has(mutation.templateNodeId)
            : scope.fields.has(mutation.fieldDefinitionId))
    );
  }
  if (mutation.kind === "template-node-detach") {
    return (
      scope.nodes.has(mutation.ownerNodeId) ||
      scope.nodes.has(mutation.templateNodeId) ||
      (mutation.sourceSchemaIds ?? []).some((schemaId) => scope.schemas.has(schemaId))
    );
  }
  if (
    mutation.kind === "field-materialize" ||
    mutation.kind === "field-initialize" ||
    mutation.kind === "field-value-delete" ||
    mutation.kind === "materialized-field-delete"
  ) {
    return (
      scope.nodes.has(mutation.ownerNodeId) ||
      scope.fields.has(mutation.fieldDefinitionId) ||
      (mutation.kind === "field-initialize" && scope.schemas.has(mutation.schemaId)) ||
      ((mutation.kind === "field-materialize" || mutation.kind === "materialized-field-delete") &&
        (scope.nodes.has(mutation.fieldNodeId) ||
          scope.occurrences.has(mutation.fieldOccurrenceId))) ||
      (mutation.kind === "field-value-delete" && scope.occurrences.has(mutation.valueOccurrenceId))
    );
  }
  if (
    "parentOccurrenceId" in mutation &&
    mutation.parentOccurrenceId !== null &&
    scope.occurrences.has(mutation.parentOccurrenceId)
  ) {
    return true;
  }
  if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
    if (scope.valueOwners.has(valueOwnerAddress(mutation.owner, mutation.namespace))) {
      return true;
    }
    if (mutation.owner.kind === "node") {
      return scope.nodes.has(mutation.owner.id);
    }
    if (mutation.owner.kind === "occurrence") {
      return scope.occurrences.has(mutation.owner.id);
    }
    if (mutation.owner.kind === "schema") {
      return scope.schemas.has(mutation.owner.id);
    }
    return scope.fields.has(mutation.owner.id);
  }
  return false;
}

function isSchemaRelation(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: `schema-${string}` }> {
  return mutation.kind.startsWith("schema-");
}

function addAnchor(
  scope: HistoryScope,
  anchor: Readonly<{ after: string | null; before: string | null }>,
): void {
  if (anchor.after !== null) {
    scope.occurrences.add(anchor.after);
  }
  if (anchor.before !== null) {
    scope.occurrences.add(anchor.before);
  }
}

function atomContributionId(id: TextAtomId): string {
  return id.slice(0, id.lastIndexOf("#"));
}
