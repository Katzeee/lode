import { describe, expect, it } from "vitest";

import { makeFact, type Fact, type AuthoredAction } from "../fact/index.js";
import { deriveActivation } from "../activation/index.js";
import { compileProjectionPlan } from "./projection-plan-dag.js";
import { invalidatedProjectionStages, PROJECTION_PLAN } from "./projection-plan.js";

const REPLICA = "101";

describe("Projection plan dataflow", () => {
  it("RULE-1 Projection plan rejects missing dependencies duplicate writers and cycles", () => {
    const evaluate = () => undefined;
    expect(() => compileProjectionPlan([{ key: "a", dependencies: ["missing"], writes: ["a"], evaluate }])).toThrow(
      "missing dependency",
    );
    expect(() =>
      compileProjectionPlan([
        { key: "a", dependencies: [], writes: ["same"], evaluate },
        { key: "b", dependencies: [], writes: ["same"], evaluate },
      ]),
    ).toThrow("Duplicate writer");
    expect(() =>
      compileProjectionPlan([
        { key: "a", dependencies: ["b"], writes: ["a"], evaluate },
        { key: "b", dependencies: ["a"], writes: ["b"], evaluate },
      ]),
    ).toThrow("dependency cycle");
  });

  it("RULE-2 Projection convergence has a finite hard bound", () => {
    const facts = [
      editFact(
        1,
        { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
        "proposal",
      ),
      editFact(
        2,
        {
          kind: "placement-create",
          placementId: "occurrence",
          nodeId: "node",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        "proposal",
      ),
    ];
    const activation = deriveActivation(facts, "origin");
    expect(activation.activeActionIds.size).toBe(0);
  });

  it("RULE-3 invalidation reaches only declared stage downstream", () => {
    const beforeFacts = [
      editFact(1, { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null }),
    ];
    const afterFacts = [
      ...beforeFacts,
      editFact(2, {
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        insert: "tail",
      }),
    ];
    const invalidated = invalidatedProjectionStages(afterFacts.slice(beforeFacts.length));
    expect([...PROJECTION_PLAN.downstream(invalidated)]).toEqual([
      "content",
      "supertag-relations",
      "conflict",
      "template",
      "view",
      "assembly",
    ]);
  });
});

function editFact(sequence: number, authoredAction: AuthoredAction, intent: "direct" | "proposal" = "direct"): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence,
    observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
    lamport: sequence,
    body: { kind: "edit", actorId: "actor", intent, actions: [authoredAction] },
  });
}
