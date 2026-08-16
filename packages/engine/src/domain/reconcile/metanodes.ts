import { compareFacts, stableStringCompare, type ContributionFact } from "../fact/index.js";

export type Metanodes = Readonly<Record<string, string>>;

export function projectMetanodes(active: readonly ContributionFact[], existingNodeIds: ReadonlySet<string>): Metanodes {
  const candidates = new Map<string, Set<string>>();
  for (const fact of [...active].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "metanode-attach") {
      continue;
    }
    const hostCandidates = candidates.get(mutation.hostNodeId) ?? new Set<string>();
    if (existingNodeIds.has(mutation.hostNodeId) && existingNodeIds.has(mutation.metanodeId)) {
      hostCandidates.add(mutation.metanodeId);
    }
    candidates.set(mutation.hostNodeId, hostCandidates);
  }

  return Object.fromEntries(
    [...candidates]
      .sort(([left], [right]) => stableStringCompare(left, right))
      .flatMap(([hostNodeId, roots]) => {
        if (roots.size !== 1) {
          return [];
        }
        const rootNodeId = [...roots][0];
        return rootNodeId === undefined ? [] : [[hostNodeId, rootNodeId] as const];
      }),
  );
}
