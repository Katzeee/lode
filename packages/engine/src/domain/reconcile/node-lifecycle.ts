import type { ContributionFact } from "../fact/index.js";

export function knownNodeIds(active: readonly ContributionFact[]): ReadonlySet<string> {
  return new Set(active.flatMap((fact) => createdNodeIds(fact)));
}

function createdNodeIds(fact: ContributionFact): readonly string[] {
  const mutation = fact.body.mutation;
  return mutation.kind === "node-create" ? [mutation.nodeId] : [];
}
