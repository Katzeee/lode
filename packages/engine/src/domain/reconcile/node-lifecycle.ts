import type { ContributionFact } from "../fact/index.js";

export function knownNodeIds(active: readonly ContributionFact[]): ReadonlySet<string> {
  return new Set(active.flatMap((fact) => createdNodeIds(fact)));
}

function createdNodeIds(fact: ContributionFact): readonly string[] {
  const mutation = fact.body.mutation;
  return mutation.kind === "node-create" ? [mutation.nodeId] : [];
}

export function nodeDeletionFactIds(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly string[]> {
  const restored = new Set(
    active.flatMap((fact) =>
      fact.body.mutation.kind === "node-restore" ? [fact.body.mutation.deletionFactId] : [],
    ),
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
