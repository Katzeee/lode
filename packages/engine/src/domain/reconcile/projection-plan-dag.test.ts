import { describe, expect, it } from "vitest";

import { frontierOf, makeFact, type Fact, type Mutation } from "../fact/index.js";
import {
  advanceGeneration,
  compileProjectionPlan,
  deriveActivation,
  rebuildGeneration,
} from "./index.js";
import { PROJECTION_PLAN } from "./projection-plan.js";

const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const versions = { rulesVersion: "proposal-rules-3", schemaVersion: "lode-schema-16" } as const;

describe("Projection plan dataflow", () => {
  it("production stage outputs are statically single-writer partitions", () => {
    const outputs = PROJECTION_PLAN.ordered.flatMap((stage) => stage.writes);
    expect(new Set(outputs).size).toBe(outputs.length);
    expect(PROJECTION_PLAN.ordered.find((stage) => stage.key === "text")?.writes).toEqual(["text"]);
    expect(PROJECTION_PLAN.ordered.find((stage) => stage.key === "value")?.writes).toEqual([
      "values",
    ]);
    expect(PROJECTION_PLAN.ordered.find((stage) => stage.key === "assembly")?.writes).toEqual([
      "projection",
    ]);
  });

  it("RULE-1 Projection plan rejects missing dependencies duplicate writers and cycles", () => {
    const evaluate = () => undefined;
    expect(() =>
      compileProjectionPlan([{ key: "a", dependencies: ["missing"], writes: ["a"], evaluate }]),
    ).toThrow("missing dependency");
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
    expect(result.stats.evaluatedStages).toEqual(["activation", "text", "assembly"]);
    expect(result.generation.planCaches.origin.activeContributionIds).toEqual(
      afterFacts.map((fact) => fact.id),
    );
  });

  it("production stage evaluators execute in compiled order and fail at an atomic boundary", () => {
    const facts = [contribution(1, { kind: "node-create", nodeId: "node" })];
    const observed: string[] = [];
    expect(() =>
      rebuildGeneration("workspace", { facts, frontier: frontierOf(facts) }, versions, {
        stageObserver(stage, view) {
          observed.push(`${view}/${stage}`);
          if (view === "review" && stage === "schema") {
            throw new Error("injected stage failure");
          }
        },
      }),
    ).toThrow("injected stage failure");
    expect(observed.slice(0, 8)).toEqual([
      "origin/activation",
      "origin/node",
      "origin/value",
      "origin/occurrence",
      "origin/owner",
      "origin/schema",
      "origin/text",
      "origin/assembly",
    ]);
  });
});

function contribution(
  sequence: number,
  mutation: Mutation,
  intent: "direct" | "proposal" = "direct",
): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId: REPLICA,
    sequence,
    observed: sequence === 1 ? {} : { [REPLICA]: sequence - 1 },
    lamport: sequence,
    body: { kind: "contribution", actorId: "actor", intent, mutation },
  });
}
