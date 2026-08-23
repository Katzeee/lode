import { textAtoms, type ScopedProjectionGeneration } from "../reconcile/index.js";
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
  const originIds = new Set(textAtoms(generation.origin.nodes[nodeId]).map((atom) => atom.factActionId));
  for (const atom of textAtoms(generation.review.nodes[nodeId])) {
    if (!originIds.has(atom.factActionId)) {
      impacts.add(atom.factActionId);
    }
  }
}
