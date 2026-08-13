import type { Facts } from "./reconcile-test-helpers.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function addPlacedNode(
  facts: Facts,
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
