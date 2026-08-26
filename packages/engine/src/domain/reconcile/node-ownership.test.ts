import { describe, expect, it } from "vitest";

import { factActions, makeFact, type FactAction } from "../fact/index.js";
import { projectNodeOwnership } from "./node-ownership.js";

describe("Node ownership projection", () => {
  it("deterministically keeps concurrent Owner moves from forming a cycle", () => {
    const facts = [
      ownerFact("101", 1, 1, "a", "workspace", "node-create"),
      ownerFact("101", 2, 2, "b", "workspace", "node-create"),
      ownerFact("202", 1, 3, "a", "b", "node-restore"),
      ownerFact("303", 1, 3, "b", "a", "node-restore"),
    ];
    const nodes = new Map(
      ["workspace", "a", "b"].map((nodeId) => [nodeId, { nodeId, intrinsicNodeType: null, content: [] }]),
    );

    expect(projectNodeOwnership("workspace", facts, nodes, occurrences(facts)).nodeOwners).toEqual({
      workspace: null,
      a: "b",
      b: "workspace",
    });
    expect(projectNodeOwnership("workspace", [...facts].reverse(), nodes, occurrences(facts)).nodeOwners).toEqual({
      workspace: null,
      a: "b",
      b: "workspace",
    });
  });
});

function ownerFact(
  replicaId: string,
  sequence: number,
  lamport: number,
  nodeId: string,
  ownerNodeId: string,
  kind: "node-create" | "node-restore",
): FactAction {
  const fact = makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence,
    observed: sequence === 1 ? {} : { [replicaId]: sequence - 1 },
    lamport,
    body: {
      kind: "action",
      actorId: "actor",
      intent: "direct",
      actions: [
        kind === "node-create"
          ? { kind, nodeId, ownerNodeId, originalPlacement: null }
          : {
              kind,
              nodeId,
              placementId: `${nodeId}-original`,
              parentNodeId: ownerNodeId,
              anchor: { after: null, before: null, affinity: "after", fallback: "end" },
            },
      ],
    },
  });
  const action = factActions(fact)[0];
  if (!action) {
    throw new Error("Expected owner FactAction");
  }
  return action;
}

function occurrences(facts: readonly FactAction[]) {
  return new Map(
    facts.flatMap((fact) =>
      fact.action.kind === "node-create" || fact.action.kind === "node-restore"
        ? [
            [
              `${fact.action.nodeId}-original`,
              {
                occurrenceId: `${fact.action.nodeId}-original`,
                nodeId: fact.action.nodeId,
                parentNodeId: fact.action.kind === "node-create" ? fact.action.ownerNodeId : fact.action.parentNodeId,
                derived: false,
              },
            ] as const,
          ]
        : [],
    ),
  );
}
