import type { Engine, NodeOccurrence } from "../core/index.js";
import { invalidDomainInput } from "./errors.js";

export function requireOccurrence(doc: Engine, occurrenceId: string): NodeOccurrence {
  const node = doc.getOccurrence(occurrenceId);
  if (!node) {
    invalidDomainInput(`Occurrence not found: ${occurrenceId}`, {
      reason: "occurrence_not_found",
      occurrenceId,
    });
  }
  return node;
}

export function requireCanonicalOccurrence(doc: Engine, occurrenceId: string): NodeOccurrence {
  const occurrence = requireOccurrence(doc, occurrenceId);
  return doc.mustGetOccurrence(doc.getCanonicalOccurrenceId(occurrence.nodeId));
}

export function requireNodeById(doc: Engine, nodeId: string): NodeOccurrence {
  try {
    return doc.mustGetOccurrence(doc.getCanonicalOccurrenceId(nodeId));
  } catch {
    invalidDomainInput(`Node not found: ${nodeId}`, {
      reason: "node_not_found",
      nodeId,
    });
  }
}
