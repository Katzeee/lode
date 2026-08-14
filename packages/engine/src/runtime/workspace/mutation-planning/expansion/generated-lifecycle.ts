import {
  FIELD_NODE_TYPE,
  type JsonValue,
  type Mutation,
  type NodeSeed,
  type SequenceAnchor,
} from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";

export function createNodeUnlessPresent(
  nodeId: string,
  available: ScopedProjection,
  seed?: NodeSeed,
): readonly Mutation[] {
  return available.nodes[nodeId]
    ? []
    : [{ kind: "node-create", nodeId, ...(seed ? { seed } : {}) }];
}

export function declareFieldNodeUnlessPresent(
  nodeId: string,
  available: ScopedProjection,
): readonly Mutation[] {
  return available.nodeStatuses[nodeId]?.nodeType === FIELD_NODE_TYPE
    ? []
    : [{ kind: "node-type-declare", nodeId, nodeType: FIELD_NODE_TYPE }];
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

export function nodeSeed(
  properties: Readonly<Record<string, JsonValue>>,
  metadata: Readonly<Record<string, JsonValue>>,
  additions: Readonly<Record<string, JsonValue>> = {},
  text: NodeSeed["text"] = [],
): NodeSeed {
  return { text, properties: { ...properties, ...additions }, metadata: { ...metadata } };
}
