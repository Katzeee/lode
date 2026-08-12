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

export function validateStoredTree(occurrences: ReadonlyMap<string, MutableOccurrence>): void {
  for (const occurrence of occurrences.values()) {
    const seen = new Set<string>();
    let cursor: MutableOccurrence | undefined = occurrence;
    while (cursor) {
      if (seen.has(cursor.occurrenceId)) {
        throw new Error(`Occurrence tree cycle: ${occurrence.occurrenceId}`);
      }
      seen.add(cursor.occurrenceId);
      cursor = cursor.parentOccurrenceId ? occurrences.get(cursor.parentOccurrenceId) : undefined;
    }
  }
}

function deleteOccurrence(
  occurrenceId: string,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
): void {
  for (const childId of [...(children.get(occurrenceId) ?? [])]) {
    deleteOccurrence(childId, occurrences, children);
  }
  children.delete(occurrenceId);
  removePlacement(children, occurrenceId);
  occurrences.delete(occurrenceId);
}
