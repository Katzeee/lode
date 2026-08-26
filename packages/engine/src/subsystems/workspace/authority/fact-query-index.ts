import {
  compareCausalOrder,
  factActions,
  type Fact,
  type FactActionId,
  type FactId,
  actionRelations,
} from "../../../domain/fact/index.js";

export class FactQueryIndex {
  private readonly factsById = new Map<FactId, Fact>();
  private readonly factIdsByScope = new Map<string, Set<FactId>>();
  private readonly ownerFactIdByActionId = new Map<FactActionId, FactId>();
  private readonly scopesByFactId = new Map<FactId, readonly string[]>();

  static build(facts: readonly Fact[]): FactQueryIndex {
    const index = new FactQueryIndex();
    facts.forEach((fact) => index.addFact(fact));
    return index;
  }

  append(facts: readonly Fact[]): void {
    for (const fact of facts) {
      this.addFact(fact);
    }
  }

  facts(factIds: readonly FactId[]): readonly Fact[] {
    return [...new Set(factIds)]
      .flatMap((factId) => (this.factsById.get(factId) ? [this.factsById.get(factId)!] : []))
      .sort(compareCausalOrder);
  }

  factsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[] {
    return this.facts(
      actionIds.flatMap((actionId) => {
        const factId = this.ownerFactIdByActionId.get(actionId);
        return factId ? [factId] : [];
      }),
    );
  }

  relatedFacts(seedFactIds: readonly FactId[]): readonly Fact[] {
    const selected = new Set<FactId>();
    const queue = [...new Set(seedFactIds)];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const factId = queue[cursor];
      if (factId === undefined) {
        throw new Error("Fact relation queue lost an entry");
      }
      if (selected.has(factId)) {
        continue;
      }
      const fact = this.factsById.get(factId);
      if (!fact) {
        continue;
      }
      selected.add(factId);
      for (const key of this.scopesByFactId.get(fact.id) ?? []) {
        for (const relatedId of this.factIdsByScope.get(key) ?? []) {
          if (!selected.has(relatedId)) {
            queue.push(relatedId);
          }
        }
      }
    }
    return this.facts([...selected]);
  }

  relatedFactsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[] {
    return this.relatedFacts(this.factsOwningActions(actionIds).map((fact) => fact.id));
  }

  private addFact(fact: Fact): void {
    if (this.factsById.has(fact.id)) {
      return;
    }
    this.factsById.set(fact.id, fact);
    const actions = factActions(fact);
    for (const action of actions) {
      this.ownerFactIdByActionId.set(action.id, fact.id);
    }
    const scopes = scopeKeys(fact, actions);
    this.scopesByFactId.set(fact.id, scopes);
    for (const key of scopes) {
      const values = this.factIdsByScope.get(key) ?? new Set<FactId>();
      values.add(fact.id);
      this.factIdsByScope.set(key, values);
    }
  }
}

function scopeKeys(fact: Fact, actions = factActions(fact)): readonly string[] {
  const keys = new Set<string>([factKey(fact.id)]);
  if (fact.body.kind === "resolution") {
    fact.body.proposalFactIds.forEach((id) => keys.add(factKey(id)));
    fact.body.adjudicatesResolutionIds.forEach((id) => keys.add(factKey(id)));
  } else if (fact.body.kind === "governance") {
    // Governance Facts carry no content scopes.
  } else {
    for (const action of actions) {
      keys.add(actionKey(action.id));
      const relations = actionRelations(action.action);
      relations.nodeIds.forEach((id) => keys.add(nodeKey(id)));
      relations.occurrenceIds.forEach((id) => keys.add(occurrenceKey(id)));
      relations.actionIds.forEach((id) => keys.add(actionKey(id)));
      relations.inlineReferenceIds.forEach((id) => keys.add(inlineReferenceKey(id)));
    }
  }
  return [...keys];
}

function factKey(id: string): string {
  return `fact/${id}`;
}

function actionKey(id: string): string {
  return `action/${id}`;
}

function nodeKey(id: string): string {
  return `node/${id}`;
}

function occurrenceKey(id: string): string {
  return `occurrence/${id}`;
}

function inlineReferenceKey(id: string): string {
  return `inline-reference/${id}`;
}
