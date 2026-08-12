import { describe, expect, it } from "vitest";

import { frontierOf, makeFact, type Fact, type Mutation } from "../fact/index.js";
import {
  advanceGeneration,
  compileOwnerDag,
  deriveActivation,
  rebuildGeneration,
} from "./index.js";
import { PROJECTION_OWNER_DAG } from "./projection-owner-plan.js";

const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;

describe("projection owner dataflow", () => {
  it("production owner outputs are statically single-writer partitions", () => {
    const outputs = PROJECTION_OWNER_DAG.ordered.flatMap((owner) => owner.writes);
    expect(new Set(outputs).size).toBe(outputs.length);
    expect(PROJECTION_OWNER_DAG.ordered.find((owner) => owner.key === "text")?.writes).toEqual([
      "text",
    ]);
    expect(PROJECTION_OWNER_DAG.ordered.find((owner) => owner.key === "value")?.writes).toEqual([
      "values",
    ]);
    expect(PROJECTION_OWNER_DAG.ordered.find((owner) => owner.key === "assembly")?.writes).toEqual([
      "projection",
    ]);
  });

  it("RULE-1 owner DAG rejects missing dependencies duplicate writers and cycles", () => {
    const evaluate = () => undefined;
    expect(() =>
      compileOwnerDag([{ key: "a", dependencies: ["missing"], writes: ["a"], evaluate }]),
    ).toThrow("missing dependency");
    expect(() =>
      compileOwnerDag([
        { key: "a", dependencies: [], writes: ["same"], evaluate },
        { key: "b", dependencies: [], writes: ["same"], evaluate },
      ]),
    ).toThrow("Duplicate writer");
    expect(() =>
      compileOwnerDag([
        { key: "a", dependencies: ["b"], writes: ["a"], evaluate },
        { key: "b", dependencies: ["a"], writes: ["b"], evaluate },
      ]),
    ).toThrow("dependency cycle");
  });

  it("RULE-2 owner convergence has a finite hard bound", () => {
    const facts = [
      contribution(1, { kind: "node-create", nodeId: "node" }, "proposal"),
      contribution(
        2,
        {
          kind: "occurrence-create",
          occurrenceId: "occurrence",
          nodeId: "node",
          parentOccurrenceId: null,
          parentPolicy: "cascade",
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        "proposal",
      ),
    ];
    const activation = deriveActivation(facts, "origin");
    expect(activation.convergencePasses).toBeLessThanOrEqual(facts.length + 1);
    expect(activation.activeContributionIds.size).toBe(0);
  });

  it("RULE-3 invalidation reaches only declared owner downstream", () => {
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
    expect(result.stats.evaluatedOwners).toEqual(["activation", "text", "assembly"]);
    expect(result.generation.ownerCaches.origin.activeContributionIds).toEqual(
      afterFacts.map((fact) => fact.id),
    );
  });

  it("production owner evaluators execute in compiled order and fail at an atomic boundary", () => {
    const facts = [contribution(1, { kind: "node-create", nodeId: "node" })];
    const observed: string[] = [];
    expect(() =>
      rebuildGeneration("workspace", { facts, frontier: frontierOf(facts) }, versions, {
        ownerObserver(owner, view) {
          observed.push(`${view}/${owner}`);
          if (view === "review" && owner === "schema") {
            throw new Error("injected owner failure");
          }
        },
      }),
    ).toThrow("injected owner failure");
    expect(observed.slice(0, 8)).toEqual([
      "origin/activation",
      "origin/node",
      "origin/value",
      "origin/occurrence",
      "origin/canonical",
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
