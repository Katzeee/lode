import type { Fact, Mutation, NodeType } from "../../../src/domain/fact/index.js";

type PlacedNodeFacts = Readonly<{
  add(mutation: Mutation, intent?: "direct" | "proposal"): Fact;
  addTransaction(mutations: readonly Mutation[], intent?: "direct" | "proposal"): readonly Fact[];
}>;

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function addPlacedNode(
  facts: PlacedNodeFacts,
  nodeId: string,
  intent: "direct" | "proposal" = "direct",
  parentNodeId = "workspace",
  occurrenceId = `${nodeId}-original`,
): void {
  facts.addTransaction(
    [
      { kind: "node-create", nodeId },
      { kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor: end },
    ],
    intent,
  );
}

export function addDefinitionNode(
  facts: PlacedNodeFacts,
  nodeId: string,
  nodeType: NodeType,
  intent: "direct" | "proposal" = "direct",
): void {
  addPlacedNode(facts, nodeId, intent);
  facts.add({ kind: "node-type-declare", nodeId, nodeType }, intent);
}
