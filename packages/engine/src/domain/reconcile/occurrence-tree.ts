import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { removePlacement } from "./sequence.js";

export function removeOccurrencesWithMissingNodes(
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
): void {
  for (const [id, occurrence] of occurrences) {
    if (!nodes.has(occurrence.nodeId)) {
      deleteOccurrence(id, occurrences, children);
    }
  }
}

export function validateStoredTree(
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
): void {
  for (const occurrence of occurrences.values()) {
    if (!nodes.has(occurrence.parentNodeId)) {
      throw new Error(`Placement parent Node is absent: ${occurrence.occurrenceId}`);
    }
  }
}

function deleteOccurrence(
  occurrenceId: string,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
): void {
  removePlacement(children, occurrenceId);
  occurrences.delete(occurrenceId);
}
