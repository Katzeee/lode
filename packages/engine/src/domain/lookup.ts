import type { Engine, NodeOccurrence } from "../core/index.js";
import { invalidDomainInput } from "./errors.js";

export async function requireOccurrence(
  doc: Engine,
  occurrenceId: string,
): Promise<NodeOccurrence> {
  const node = await doc.getOccurrence(occurrenceId);
  if (!node) {
    invalidDomainInput(`Occurrence not found: ${occurrenceId}`, {
      reason: "occurrence_not_found",
      occurrenceId,
    });
  }
  return node;
}

export async function requireCanonicalOccurrence(
  doc: Engine,
  occurrenceId: string,
): Promise<NodeOccurrence> {
  const occurrence = await requireOccurrence(doc, occurrenceId);
  return doc.mustGetOccurrence(await doc.getCanonicalOccurrenceId(occurrence.nodeId));
}

export async function requireNodeById(doc: Engine, nodeId: string): Promise<NodeOccurrence> {
  try {
    return await doc.mustGetOccurrence(await doc.getCanonicalOccurrenceId(nodeId));
  } catch {
    invalidDomainInput(`Node not found: ${nodeId}`, {
      reason: "node_not_found",
      nodeId,
    });
  }
}
