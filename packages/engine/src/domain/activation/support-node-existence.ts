import type { ContributionFact } from "../fact/index.js";

export function registerNodeExistence(
  contributions: readonly ContributionFact[],
  support: Map<string, string[]>,
  eligible: ReadonlySet<string>,
  viable: Set<string>,
): void {
  for (const fact of contributions) {
    if (fact.body.mutation.kind === "node-create") {
      const candidates = support.get(fact.body.mutation.nodeId) ?? [];
      candidates.push(fact.id);
      support.set(fact.body.mutation.nodeId, candidates);
      if (eligible.has(fact.id)) {
        viable.add(fact.id);
      }
    }
  }
}
