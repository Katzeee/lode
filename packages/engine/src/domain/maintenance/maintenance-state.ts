import { mutationRelations, type ContributionFact, type Fact, type Mutation } from "../fact/index.js";

export function purgedNodeIds(facts: readonly Fact[]): ReadonlySet<string> {
  return new Set(
    facts.flatMap((fact) =>
      fact.body.kind === "maintenance" && fact.body.action.kind === "node-purge" ? [fact.body.action.nodeId] : [],
    ),
  );
}

export function excludePurgedContributions(
  facts: readonly ContributionFact[],
  purged: ReadonlySet<string>,
): readonly ContributionFact[] {
  return purged.size === 0
    ? facts
    : facts.filter((fact) => ![...purged].some((nodeId) => mutationReferencesNode(fact.body.mutation, nodeId)));
}

export function mutationReferencesNode(mutation: Mutation, nodeId: string): boolean {
  return mutationRelations(mutation).nodeIds.includes(nodeId);
}

export function nodeDeletionFactIds(active: readonly ContributionFact[]): ReadonlyMap<string, readonly string[]> {
  const restored = new Set(
    active.flatMap((fact) => (fact.body.mutation.kind === "node-restore" ? [fact.body.mutation.deletionFactId] : [])),
  );
  const result = new Map<string, string[]>();
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "node-delete" && !restored.has(fact.id)) {
      const ids = result.get(mutation.nodeId) ?? [];
      ids.push(fact.id);
      result.set(mutation.nodeId, ids);
    }
  }
  return result;
}
