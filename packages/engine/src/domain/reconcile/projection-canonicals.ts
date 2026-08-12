import { stableStringCompare, type ContributionFact } from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";

export function normalizedCanonicals(
  current: Readonly<Record<string, string>>,
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
): Readonly<Record<string, string>> {
  const canonicals = new Map(Object.entries(current));
  for (const [nodeId, occurrenceId] of canonicals) {
    if (!nodes.has(nodeId) || occurrences.get(occurrenceId)?.nodeId !== nodeId) {
      canonicals.delete(nodeId);
    }
  }
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (
      mutation.kind === "canonical-occurrence-set" &&
      occurrences.get(mutation.occurrenceId)?.nodeId === mutation.nodeId
    ) {
      canonicals.set(mutation.nodeId, mutation.occurrenceId);
    }
  }
  for (const nodeId of nodes.keys()) {
    if (!canonicals.has(nodeId)) {
      const candidate = [...occurrences.values()]
        .filter((occurrence) => occurrence.nodeId === nodeId)
        .map((occurrence) => occurrence.occurrenceId)
        .sort(stableStringCompare)[0];
      if (candidate) {
        canonicals.set(nodeId, candidate);
      }
    }
  }
  return Object.fromEntries(
    [...canonicals].sort(([left], [right]) => stableStringCompare(left, right)),
  );
}
