import type { ContributionFact, SequenceAnchor } from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { insertAtAnchor, listFor } from "./sequence.js";

export function placeCreatedOccurrence(
  mutation: Extract<ContributionFact["body"]["mutation"], { kind: "occurrence-create" }>,
  occurrences: Map<string, MutableOccurrence>,
  childOccurrences: Map<string, string[]>,
  nodes: ReadonlyMap<string, MutableNode>,
  createdIdentities: Set<string>,
): void {
  if (
    !nodes.has(mutation.nodeId) ||
    createdIdentities.has(mutation.occurrenceId) ||
    hasPlacement(occurrences, mutation.nodeId, mutation.parentNodeId)
  ) {
    return;
  }
  createdIdentities.add(mutation.occurrenceId);
  placeOccurrence(
    occurrences,
    childOccurrences,
    newOccurrence(mutation.occurrenceId, mutation.nodeId, mutation.parentNodeId),
    mutation.anchor,
    nodes,
  );
}

export function hasPlacement(
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  nodeId: string,
  parentNodeId: string,
  excludedOccurrenceId?: string,
): boolean {
  return [...occurrences.values()].some(
    (occurrence) =>
      occurrence.occurrenceId !== excludedOccurrenceId &&
      occurrence.nodeId === nodeId &&
      occurrence.parentNodeId === parentNodeId,
  );
}

export function newOccurrence(
  occurrenceId: string,
  nodeId: string,
  parentNodeId: string,
  derived = false,
): MutableOccurrence {
  return {
    occurrenceId,
    nodeId,
    parentNodeId,
    derived,
  };
}

export function placeOccurrence(
  occurrences: Map<string, MutableOccurrence>,
  childOccurrences: Map<string, string[]>,
  occurrence: MutableOccurrence,
  anchor: SequenceAnchor,
  nodes: ReadonlyMap<string, MutableNode>,
): void {
  if (!nodes.has(occurrence.parentNodeId)) {
    return;
  }
  occurrences.set(occurrence.occurrenceId, occurrence);
  insertAtAnchor(listFor(childOccurrences, occurrence.parentNodeId), occurrence.occurrenceId, anchor);
}

export function createdOccurrenceNodeId(active: readonly ContributionFact[], occurrenceId: string): string | null {
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "occurrence-create" && mutation.occurrenceId === occurrenceId) {
      return mutation.nodeId;
    }
  }
  return null;
}
