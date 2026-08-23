import type { IntrinsicNodeType, AuthoredAction, NodeSeed, SequenceAnchor } from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";

export function createNodeUnlessPresent(
  nodeId: string,
  ownerNodeId: string,
  originalPlacement: Readonly<{ placementId: string; anchor: SequenceAnchor }> | null,
  available: ScopedProjection,
  options: Readonly<{ seed?: NodeSeed; intrinsicNodeType?: IntrinsicNodeType }> = {},
): readonly AuthoredAction[] {
  return available.nodes[nodeId]
    ? []
    : [
        {
          kind: "node-create",
          nodeId,
          ownerNodeId,
          originalPlacement,
          ...(options.intrinsicNodeType ? { intrinsicNodeType: options.intrinsicNodeType } : {}),
          ...(options.seed ? { seed: options.seed } : {}),
        },
      ];
}

export function createOccurrenceUnlessPresent(
  occurrenceId: string,
  nodeId: string,
  parentNodeId: string,
  anchor: SequenceAnchor,
  available: ScopedProjection,
): readonly AuthoredAction[] {
  return available.occurrences[occurrenceId]
    ? []
    : [{ kind: "placement-create", placementId: occurrenceId, nodeId, parentNodeId, anchor }];
}

export function nodeSeed(text: NodeSeed["text"] = []): NodeSeed {
  return { text };
}
