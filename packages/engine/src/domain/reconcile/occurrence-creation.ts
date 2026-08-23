import type { FactAction, SequenceAnchor } from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { insertAtAnchor, listFor } from "./sequence.js";

export function placeCreatedOccurrence(
  authoredAction: Extract<FactAction["action"], { kind: "placement-create" }>,
  occurrences: Map<string, MutableOccurrence>,
  childOccurrences: Map<string, string[]>,
  nodes: ReadonlyMap<string, MutableNode>,
): boolean {
  const existing = occurrences.get(authoredAction.placementId);
  if (
    !nodes.has(authoredAction.nodeId) ||
    (existing !== undefined && existing.nodeId !== authoredAction.nodeId) ||
    hasPlacement(occurrences, authoredAction.nodeId, authoredAction.parentNodeId, authoredAction.placementId)
  ) {
    return false;
  }
  if (existing) {
    const siblings = childOccurrences.get(existing.parentNodeId);
    if (siblings) {
      const index = siblings.indexOf(authoredAction.placementId);
      if (index >= 0) {
        siblings.splice(index, 1);
      }
    }
  }
  placeOccurrence(
    occurrences,
    childOccurrences,
    newOccurrence(authoredAction.placementId, authoredAction.nodeId, authoredAction.parentNodeId),
    authoredAction.anchor,
    nodes,
  );
  return occurrences.get(authoredAction.placementId)?.parentNodeId === authoredAction.parentNodeId;
}

function hasPlacement(
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

function newOccurrence(occurrenceId: string, nodeId: string, parentNodeId: string, derived = false): MutableOccurrence {
  return {
    occurrenceId,
    nodeId,
    parentNodeId,
    derived,
  };
}

function placeOccurrence(
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
