import { compareFacts, contributionFactsOfKind, factObserves, type ContributionFact } from "../fact/index.js";
import type { MutableOccurrence } from "./projection-state.js";

export function boundSupertagTemplateNodes(
  active: readonly ContributionFact[],
  knownNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  const removals = contributionFactsOfKind(active, "supertag-template-node-remove");
  type Binding = { occurrenceId: string; fact: ContributionFact };
  const bySupertag = new Map<string, Map<string, Binding>>();
  for (const fact of [...contributionFactsOfKind(active, "supertag-template-node-add")].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    const removed = removals.some((candidate) => {
      const removal = candidate.body.mutation;
      return (
        removal.supertagId === mutation.supertagId &&
        removal.templateNodeId === mutation.templateNodeId &&
        removal.templateOccurrenceId === mutation.templateOccurrenceId &&
        factObserves(candidate, fact)
      );
    });
    const occurrence = occurrences.get(mutation.templateOccurrenceId);
    const creation = occurrenceCreation(active, mutation.templateOccurrenceId);
    if (
      removed ||
      !knownNodeIds.has(mutation.supertagId) ||
      !knownNodeIds.has(mutation.templateNodeId) ||
      creation?.nodeId !== mutation.templateNodeId ||
      creation?.parentNodeId !== mutation.supertagId ||
      (occurrence !== undefined &&
        (occurrence.nodeId !== mutation.templateNodeId || occurrence.parentNodeId !== mutation.supertagId))
    ) {
      continue;
    }
    const bindings = bySupertag.get(mutation.supertagId) ?? new Map<string, Binding>();
    bindings.set(mutation.templateNodeId, {
      occurrenceId: mutation.templateOccurrenceId,
      fact,
    });
    bySupertag.set(mutation.supertagId, bindings);
  }
  return Object.fromEntries(
    [...bySupertag].map(([supertagId, bindings]) => {
      const occurrenceIds = childOccurrences.get(supertagId) ?? [];
      return [
        supertagId,
        [...bindings]
          .sort(([, left], [, right]) => compareBindings(left, right, occurrenceIds))
          .map(([templateNodeId]) => templateNodeId),
      ];
    }),
  );
}

function compareBindings(
  left: { occurrenceId: string; fact: ContributionFact },
  right: { occurrenceId: string; fact: ContributionFact },
  occurrenceIds: readonly string[],
): number {
  const leftIndex = occurrenceIndex(occurrenceIds, left.occurrenceId);
  const rightIndex = occurrenceIndex(occurrenceIds, right.occurrenceId);
  return leftIndex === rightIndex ? compareFacts(left.fact, right.fact) : leftIndex - rightIndex;
}

function occurrenceIndex(occurrenceIds: readonly string[], occurrenceId: string): number {
  const index = occurrenceIds.indexOf(occurrenceId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function occurrenceCreation(
  active: readonly ContributionFact[],
  occurrenceId: string,
): Readonly<{ nodeId: string; parentNodeId: string }> | undefined {
  return contributionFactsOfKind(active, "occurrence-create").find(
    (candidate) => candidate.body.mutation.occurrenceId === occurrenceId,
  )?.body.mutation;
}
