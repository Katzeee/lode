import { describe, expect, it } from "vitest";

import { frontierOf, makeFact, type Fact, type Mutation } from "../fact/index.js";
import { deriveActivation } from "../activation/index.js";
import { advanceGeneration, rebuildGeneration, CURRENT_PROJECTION_VERSIONS as versions } from "./index.js";
import { compileProjectionPlan } from "./projection-plan-dag.js";

const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";

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
      contribution(1, { kind: "node-create", nodeId: "node" }, "proposal"),
      contribution(
        2,
        {
          kind: "occurrence-create",
          occurrenceId: "occurrence",
          nodeId: "node",
          parentNodeId: "workspace",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        "proposal",
      ),
    ];
    const activation = deriveActivation(facts, "origin");
    expect(activation.convergencePasses).toBeLessThanOrEqual(facts.length + 1);
    expect(activation.activeContributionIds.size).toBe(0);
  });

  it("RULE-3 invalidation reaches only declared stage downstream", () => {
    const beforeFacts = [contribution(1, { kind: "node-create", nodeId: "node" })];
    const afterFacts = [
      ...beforeFacts,
      contribution(2, {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        insert: "tail",
      }),
    ];
    const before = { facts: beforeFacts, frontier: frontierOf(beforeFacts) };
    const result = advanceGeneration(
      "workspace",
      before,
      { facts: afterFacts, frontier: frontierOf(afterFacts) },
      versions,
      rebuildGeneration("workspace", before, versions).generation,
    );
    expect(result.stats.evaluatedStages).toEqual(["activation", "content", "assembly"]);
    expect(result.generation.planCaches.origin.activeContributionIds).toEqual(afterFacts.map((fact) => fact.id));
  });
});

function contribution(sequence: number, mutation: Mutation, intent: "direct" | "proposal" = "direct"): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence,
    observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
    lamport: sequence,
    body: { kind: "contribution", actorId: "actor", intent, mutation },
  });
}
