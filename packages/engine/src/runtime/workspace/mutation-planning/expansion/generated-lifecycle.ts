import {
  FIELD_INTRINSIC_NODE_TYPE,
  type Mutation,
  type NodeSeed,
  type SequenceAnchor,
} from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";

export function createNodeUnlessPresent(
  nodeId: string,
  ownerNodeId: string,
  available: ScopedProjection,
  seed?: NodeSeed,
): readonly Mutation[] {
  return available.nodes[nodeId]
    ? []
    : [
        { kind: "node-create", nodeId, ...(seed ? { seed } : {}) },
        { kind: "node-owner-set", nodeId, ownerNodeId, previousOwnerNodeId: null },
      ];
}

export function declareFieldNodeUnlessPresent(nodeId: string, available: ScopedProjection): readonly Mutation[] {
  return available.nodes[nodeId]?.intrinsicNodeType === FIELD_INTRINSIC_NODE_TYPE
    ? []
    : [{ kind: "intrinsic-node-type-declare", nodeId, intrinsicNodeType: FIELD_INTRINSIC_NODE_TYPE }];
}

export function createOccurrenceUnlessPresent(
  occurrenceId: string,
  nodeId: string,
  parentNodeId: string,
  anchor: SequenceAnchor,
  available: ScopedProjection,
): readonly Mutation[] {
  return available.occurrences[occurrenceId]
    ? []
    : [{ kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor }];
}

export function nodeSeed(text: NodeSeed["text"] = []): NodeSeed {
  return { text };
}
