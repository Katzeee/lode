import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { occurrenceIdsForNode } from "./structure-effect.js";

export function addNodeReviewImpacts(
  impacts: Set<string>,
  nodeId: string,
  generation: ScopedProjectionGeneration,
): void {
  impacts.add(nodeId);
  for (const occurrenceId of occurrenceIdsForNode(generation, nodeId)) {
    impacts.add(occurrenceId);
  }
  const originIds = new Set((generation.origin.nodes[nodeId]?.text ?? []).map((atom) => atom.contributionId));
  for (const atom of generation.review.nodes[nodeId]?.text ?? []) {
    if (!originIds.has(atom.contributionId)) {
      impacts.add(atom.contributionId);
    }
  }
}
