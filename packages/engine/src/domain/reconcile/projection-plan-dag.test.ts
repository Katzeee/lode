import { describe, expect, it } from "vitest";

import { graphActionBody, makeFact, type Fact, type GraphAction } from "../fact/index.js";
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
      actionFact(
        1,
        { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
        "proposal",
      ),
      actionFact(
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
      actionFact(1, { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null }),
    ];
    const afterFacts = [
      ...beforeFacts,
      actionFact(2, {
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

  it("seeds Projection invalidation from the owning Fact algebra", () => {
    const governance = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "governance",
        actorId: "owner",
        action: { kind: "workspace-establish", ownerActorId: "owner" },
      },
    });
    const resolution = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 2,
      observed: { [REPLICA]: 1 },
      lamport: 2,
      body: {
        kind: "resolution",
        actorId: "reviewer",
        decision: "accept",
        proposalFactIds: [],
        adjudicatesResolutionIds: [],
      },
    });

    expect([...invalidatedProjectionStages([governance])]).toEqual([]);
    expect([...invalidatedProjectionStages([resolution])]).toEqual(["activation"]);
  });
});

function actionFact(sequence: number, authoredAction: GraphAction, intent: "direct" | "proposal" = "direct"): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence,
    observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
    lamport: sequence,
    body: graphActionBody("actor", intent, [authoredAction]),
  });
}
