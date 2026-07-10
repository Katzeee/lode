import type { Engine, NodeOccurrence } from "../core/index.js";
import { invalidDomainInput } from "./errors.js";

export async function requireOccurrence(
  engine: Engine,
  occurrenceId: string,
): Promise<NodeOccurrence> {
  const node = await engine.getOccurrence(occurrenceId);
  if (!node) {
    invalidDomainInput(`Occurrence not found: ${occurrenceId}`, {
      reason: "occurrence_not_found",
      occurrenceId,
    });
  }
  return node;
}

export async function requireCanonicalOccurrence(
  engine: Engine,
  occurrenceId: string,
): Promise<NodeOccurrence> {
  const occurrence = await requireOccurrence(engine, occurrenceId);
  return engine.mustGetOccurrence(await engine.getCanonicalOccurrenceId(occurrence.nodeId));
}

export async function requireNodeById(engine: Engine, nodeId: string): Promise<NodeOccurrence> {
  try {
    return await engine.mustGetOccurrence(await engine.getCanonicalOccurrenceId(nodeId));
  } catch {
    invalidDomainInput(`Node not found: ${nodeId}`, {
      reason: "node_not_found",
      nodeId,
    });
  }
}
