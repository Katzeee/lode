import { mutationRelations, type ContributionFact, type Fact, type Mutation } from "../fact/index.js";
import { valueTargetAddress, type ScopedProjection } from "../reconcile/index.js";

type HistoryScope = {
  nodes: Set<string>;
  occurrences: Set<string>;
  schemas: Set<string>;
  fields: Set<string>;
  valueTargets: Set<string>;
  factIds: Set<string>;
};

export function scopedHistoryFacts(
  facts: readonly Fact[],
  targets: readonly ContributionFact[],
  projection: ScopedProjection,
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
    valueTargets: new Set(),
    factIds: new Set(),
  };
}

function addTemplateScope(scope: HistoryScope, projection: ScopedProjection): void {
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
  const relations = mutationRelations(mutation);
  relations.nodeIds.forEach((id) => scope.nodes.add(id));
  relations.occurrenceIds.forEach((id) => scope.occurrences.add(id));
  relations.schemaIds.forEach((id) => scope.schemas.add(id));
  relations.fieldDefinitionIds.forEach((id) => scope.fields.add(id));
  relations.factIds.forEach((id) => scope.factIds.add(id));
  for (const value of relations.values) {
    scope.valueTargets.add(valueTargetAddress(value.target, value.namespace));
  }
}

function mutationTouches(scope: HistoryScope, mutation: Mutation): boolean {
  const relations = mutationRelations(mutation);
  return (
    relations.nodeIds.some((id) => scope.nodes.has(id)) ||
    relations.occurrenceIds.some((id) => scope.occurrences.has(id)) ||
    relations.schemaIds.some((id) => scope.schemas.has(id)) ||
    relations.fieldDefinitionIds.some((id) => scope.fields.has(id)) ||
    relations.factIds.some((id) => scope.factIds.has(id)) ||
    relations.values.some((value) => scope.valueTargets.has(valueTargetAddress(value.target, value.namespace)))
  );
}
