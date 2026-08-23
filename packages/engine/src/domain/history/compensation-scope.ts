import {
  factActionsFromFacts,
  actionRelations,
  type FactAction,
  type Fact,
  type AuthoredAction,
} from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";

type HistoryScope = {
  nodes: Set<string>;
  occurrences: Set<string>;
  supertags: Set<string>;
  fields: Set<string>;
  actionIds: Set<string>;
  inlineReferences: Set<string>;
};

export function scopedHistoryFacts(
  facts: readonly Fact[],
  targets: readonly FactAction[],
  projection: ScopedProjection,
): readonly Fact[] {
  const scope = emptyScope();
  const selectedActions = new Set(targets.map((target) => target.id));
  const selectedFacts = new Set(targets.map((target) => target.factId));
  const actions = factActionsFromFacts(facts);
  targets.forEach((target) => addAction(scope, target.action));
  addTemplateScope(scope, projection);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of facts) {
      if (selectedFacts.has(fact.id)) {
        continue;
      }
      if (fact.body.kind === "resolution") {
        if (fact.body.proposalFactIds.some((target) => selectedFacts.has(target))) {
          selectedFacts.add(fact.id);
          changed = true;
        }
      }
    }
    for (const action of actions) {
      if (selectedActions.has(action.id)) {
        continue;
      }
      if (scope.actionIds.has(action.id) || actionTouches(scope, action.action)) {
        selectedActions.add(action.id);
        selectedFacts.add(action.factId);
        addAction(scope, action.action);
        addTemplateScope(scope, projection);
        changed = true;
      }
    }
  }
  return facts.filter((fact) => selectedFacts.has(fact.id));
}

function emptyScope(): HistoryScope {
  return {
    nodes: new Set(),
    occurrences: new Set(),
    supertags: new Set(),
    fields: new Set(),
    actionIds: new Set(),
    inlineReferences: new Set(),
  };
}

function addTemplateScope(scope: HistoryScope, projection: ScopedProjection): void {
  for (const instance of projection.templateNodeInstances) {
    if (
      scope.nodes.has(instance.ownerNodeId) ||
      scope.nodes.has(instance.templateNodeId) ||
      (instance.instanceNodeId !== null && scope.nodes.has(instance.instanceNodeId)) ||
      scope.occurrences.has(instance.instanceOccurrenceId) ||
      instance.sources.some((source) => scope.supertags.has(source.supertagId))
    ) {
      scope.nodes.add(instance.ownerNodeId);
      scope.nodes.add(instance.templateNodeId);
      if (instance.instanceNodeId !== null) {
        scope.nodes.add(instance.instanceNodeId);
      }
      scope.occurrences.add(instance.instanceOccurrenceId);
      instance.sources.forEach((source) => scope.supertags.add(source.supertagId));
    }
  }
}

function addAction(scope: HistoryScope, authoredAction: AuthoredAction): void {
  const relations = actionRelations(authoredAction);
  relations.nodeIds.forEach((id) => scope.nodes.add(id));
  relations.occurrenceIds.forEach((id) => scope.occurrences.add(id));
  relations.supertagIds.forEach((id) => scope.supertags.add(id));
  relations.fieldDefinitionIds.forEach((id) => scope.fields.add(id));
  relations.actionIds.forEach((id) => scope.actionIds.add(id));
  relations.inlineReferenceIds.forEach((id) => scope.inlineReferences.add(id));
}

function actionTouches(scope: HistoryScope, authoredAction: AuthoredAction): boolean {
  const relations = actionRelations(authoredAction);
  return (
    relations.nodeIds.some((id) => scope.nodes.has(id)) ||
    relations.occurrenceIds.some((id) => scope.occurrences.has(id)) ||
    relations.supertagIds.some((id) => scope.supertags.has(id)) ||
    relations.fieldDefinitionIds.some((id) => scope.fields.has(id)) ||
    relations.actionIds.some((id) => scope.actionIds.has(id)) ||
    relations.inlineReferenceIds.some((id) => scope.inlineReferences.has(id))
  );
}
