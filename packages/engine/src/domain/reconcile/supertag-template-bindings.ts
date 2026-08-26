import { compareCausalOrder, type FactAction } from "../fact/index.js";
import { causalCollectionStates } from "./causal-collection.js";
import type { MutableOccurrence } from "./projection-state.js";
import { templateMemberOccurrenceId } from "./projection-identity.js";

export function boundSupertagTemplateNodes(
  active: readonly FactAction[],
  knownNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  type Binding = { occurrenceId: string; fact: FactAction };
  const bySupertag = new Map<string, Map<string, Binding>>();
  const states = [...causalCollectionStates(active, "template-member")].sort((left, right) =>
    compareCausalOrder(left.addition, right.addition),
  );
  for (const { addition: fact, removed } of states) {
    const authoredAction = fact.action;
    const occurrenceId = templateMemberOccurrenceId(fact.id);
    const occurrence = occurrences.get(occurrenceId);
    if (
      removed ||
      !knownNodeIds.has(authoredAction.supertagId) ||
      !knownNodeIds.has(authoredAction.templateNodeId) ||
      occurrence === undefined ||
      occurrence.nodeId !== authoredAction.templateNodeId ||
      occurrence.parentNodeId !== authoredAction.supertagId
    ) {
      continue;
    }
    const bindings = bySupertag.get(authoredAction.supertagId) ?? new Map<string, Binding>();
    bindings.set(authoredAction.templateNodeId, {
      occurrenceId,
      fact,
    });
    bySupertag.set(authoredAction.supertagId, bindings);
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
  left: { occurrenceId: string; fact: FactAction },
  right: { occurrenceId: string; fact: FactAction },
  occurrenceIds: readonly string[],
): number {
  const leftIndex = occurrenceIndex(occurrenceIds, left.occurrenceId);
  const rightIndex = occurrenceIndex(occurrenceIds, right.occurrenceId);
  return leftIndex === rightIndex ? compareCausalOrder(left.fact, right.fact) : leftIndex - rightIndex;
}

function occurrenceIndex(occurrenceIds: readonly string[], occurrenceId: string): number {
  const index = occurrenceIds.indexOf(occurrenceId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
