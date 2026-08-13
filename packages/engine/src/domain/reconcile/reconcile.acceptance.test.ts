import { describe, expect, it } from "vitest";

import { frontierOf, makeFact } from "../fact/index.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
  validateGenerationCheckpoint,
} from "../../runtime/workspace/generation-checkpoint.js";
import { advanceGeneration, projectSnapshot, projectionText, rebuildGeneration } from "./index.js";
import { base, end, Facts, fullSurface, versions } from "./reconcile-test-helpers.js";

const CHECKPOINT_KEY = "reconcile-acceptance-key";

describe("production Reconcile", () => {
  it("PROJ-1 projection is deterministic for one snapshot and versions", () => {
    const facts = base();
    facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "abc",
    });
    const snapshot = facts.snapshot();
    const shuffled = { ...snapshot, facts: [...snapshot.facts].reverse() };

    expect(projectSnapshot("workspace", shuffled, "origin", versions)).toEqual(
      projectSnapshot("workspace", snapshot, "origin", versions),
    );
  });

  it("PROJ-2 origin and review share activation and support rules", () => {
    const facts = base();
    const proposal = facts.add(
      {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "proposal",
      },
      "proposal",
    );
    let snapshot = facts.snapshot();
    expect(projectionText(projectSnapshot("workspace", snapshot, "origin", versions), "node")).toBe(
      "",
    );
    expect(projectionText(projectSnapshot("workspace", snapshot, "review", versions), "node")).toBe(
      "proposal",
    );

    facts.resolve([proposal.id], "accept");
    snapshot = facts.snapshot();
    const accepted = rebuildGeneration("workspace", snapshot, versions).generation;
    expect(projectionText(accepted.origin, "node")).toBe("proposal");
    expect(accepted.origin.nodes).toEqual(accepted.review.nodes);
  });

  it("PROJ-3 full checkpoint-tail and incremental paths are equivalent", () => {
    const facts = base();
    const before = facts.snapshot();
    const generation = rebuildGeneration("workspace", before, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", before, generation, CHECKPOINT_KEY);
    expect(
      validateGenerationCheckpoint(checkpoint, "workspace", before, versions, CHECKPOINT_KEY),
    ).toEqual(generation);

    facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "tail",
    });
    const after = facts.snapshot();
    const incremental = advanceGeneration("workspace", before, after, versions, generation);
    const checkpointTail = reconcileFromCheckpoint(
      checkpoint,
      "workspace",
      after,
      versions,
      CHECKPOINT_KEY,
    );
    expect(incremental.generation).toEqual(
      rebuildGeneration("workspace", after, versions).generation,
    );
    expect(checkpointTail).toEqual(incremental);
    expect(incremental.stats).toEqual({
      evaluatedStages: ["activation", "text", "assembly"],
      supportPasses: 0,
    });
  });

  it("checkpoint tail falls back when a later arrival precedes checkpoint facts in neutral order", () => {
    const baseFact = makeFact({
      workspaceId: "workspace",
      replicaId: "mmmmmmmmmmmmmmmmmmmmmmmmmm",
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "node" },
      },
    });
    const textFact = (replicaId: string, insert: string) =>
      makeFact({
        workspaceId: "workspace",
        replicaId,
        sequence: 1,
        observed: { [baseFact.coordinate.dot.replicaId]: 1 },
        lamport: 2,
        body: {
          kind: "contribution",
          actorId: "actor",
          intent: "direct",
          mutation: {
            kind: "text-splice",
            nodeId: "node",
            deleteAtomIds: [],
            anchor: end,
            insert,
          },
        },
      });
    const checkpointFact = textFact("zzzzzzzzzzzzzzzzzzzzzzzzzz", "A");
    const lateEarlierFact = textFact("aaaaaaaaaaaaaaaaaaaaaaaaaa", "B");
    const before = {
      facts: [baseFact, checkpointFact],
      frontier: frontierOf([baseFact, checkpointFact]),
    };
    const generation = rebuildGeneration("workspace", before, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", before, generation, CHECKPOINT_KEY);
    const after = {
      facts: [baseFact, checkpointFact, lateEarlierFact],
      frontier: frontierOf([baseFact, checkpointFact, lateEarlierFact]),
    };
    const full = rebuildGeneration("workspace", after, versions);

    expect(advanceGeneration("workspace", before, after, versions, generation).generation).toEqual(
      full.generation,
    );
    expect(
      reconcileFromCheckpoint(checkpoint, "workspace", after, versions, CHECKPOINT_KEY)?.generation,
    ).toEqual(full.generation);
    expect(projectionText(full.generation.origin, "node")).toBe("BA");
  });

  it("Direct lifecycle and structure tails stay on their owner-local incremental paths", () => {
    const cases: readonly Readonly<{
      name: string;
      prepare(): Readonly<{ facts: Facts; tail(): void }>;
    }>[] = [
      {
        name: "node-create",
        prepare: () => {
          const facts = new Facts();
          return {
            facts,
            tail: () => {
              facts.add({ kind: "node-create", nodeId: "node" });
            },
          };
        },
      },
      {
        name: "node-delete",
        prepare: () => {
          const facts = base();
          return {
            facts,
            tail: () => {
              facts.add({ kind: "node-delete", nodeId: "node" });
            },
          };
        },
      },
      {
        name: "node-restore",
        prepare: () => {
          const facts = base();
          const deletion = facts.add({ kind: "node-delete", nodeId: "node" });
          return {
            facts,
            tail: () => {
              facts.add({ kind: "node-restore", nodeId: "node", deletionFactId: deletion.id });
            },
          };
        },
      },
      {
        name: "occurrence-create",
        prepare: () => {
          const facts = base();
          return {
            facts,
            tail: () => {
              facts.add({
                kind: "occurrence-create",
                occurrenceId: "second",
                nodeId: "node",
                parentNodeId: "workspace",
                anchor: end,
              });
            },
          };
        },
      },
      {
        name: "occurrence-delete",
        prepare: () => {
          const facts = base();
          return {
            facts,
            tail: () => {
              facts.add({
                kind: "occurrence-delete",
                occurrenceId: "occurrence",
                previousParentNodeId: "workspace",
                previousAnchor: { after: null, before: null, affinity: "after", fallback: "start" },
              });
            },
          };
        },
      },
      {
        name: "occurrence-restore",
        prepare: () => {
          const facts = base();
          const deletion = facts.add({
            kind: "occurrence-delete",
            occurrenceId: "occurrence",
            previousParentNodeId: "workspace",
            previousAnchor: { after: null, before: null, affinity: "after", fallback: "start" },
          });
          return {
            facts,
            tail: () => {
              facts.add({
                kind: "occurrence-restore",
                occurrenceId: "occurrence",
                deletionFactId: deletion.id,
                parentNodeId: "workspace",
                anchor: end,
              });
            },
          };
        },
      },
      {
        name: "occurrence-move",
        prepare: () => {
          const facts = base();
          facts.add({ kind: "node-create", nodeId: "parent" });
          return {
            facts,
            tail: () => {
              facts.add({
                kind: "occurrence-move",
                occurrenceId: "occurrence",
                parentNodeId: "parent",
                anchor: end,
                previousParentNodeId: "workspace",
                previousAnchor: {
                  after: null,
                  before: "parent",
                  affinity: "before",
                  fallback: "start",
                },
              });
            },
          };
        },
      },
    ];
    for (const testCase of cases) {
      const { facts, tail } = testCase.prepare();
      const before = facts.snapshot();
      const generation = rebuildGeneration("workspace", before, versions).generation;
      tail();
      const after = facts.snapshot();
      const incremental = advanceGeneration("workspace", before, after, versions, generation);
      expect(incremental.generation, testCase.name).toEqual(
        rebuildGeneration("workspace", after, versions).generation,
      );
      expect(incremental.stats.evaluatedStages, testCase.name).not.toContain("value");
      expect(incremental.stats.evaluatedStages, testCase.name).not.toHaveLength(8);
    }
  });

  it("incremental Schema Node values remain on the Node", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "schema" });
    for (const [key, value] of [
      ["a", 1],
      ["b", 2],
    ] as const) {
      facts.add({
        kind: "value-set",
        target: { kind: "node", id: "schema" },
        namespace: "schema",
        key,
        value,
      });
    }
    const before = facts.snapshot();
    const generation = rebuildGeneration("workspace", before, versions).generation;
    facts.add({
      kind: "value-set",
      target: { kind: "node", id: "schema" },
      namespace: "schema",
      key: "c",
      value: 3,
    });

    const after = facts.snapshot();
    const incremental = advanceGeneration("workspace", before, after, versions, generation);
    const full = rebuildGeneration("workspace", after, versions);

    expect(incremental.generation).toEqual(full.generation);
    expect(incremental.generation.origin.nodes.schema?.properties).toEqual({
      a: 1,
      b: 2,
      c: 3,
    });
  });

  it("MODEL-1 direct and proposal share the complete mutation vocabulary", () => {
    const direct = fullSurface("direct");
    const proposal = fullSurface("proposal");
    const directProjection = projectSnapshot("workspace", direct.snapshot(), "origin", versions);
    const proposalProjection = projectSnapshot(
      "workspace",
      proposal.snapshot(),
      "review",
      versions,
    );

    expect(proposalProjection.nodes).toEqual(directProjection.nodes);
    expect(proposalProjection.occurrences).toEqual(directProjection.occurrences);
    expect(proposalProjection.nodeOwners).toEqual(directProjection.nodeOwners);
  });

  it("MODEL-2 node and occurrence ownership preserves transclusion", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "reference-parent" });
    facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "shared",
    });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projectionText(projection, "node")).toBe("shared");
    expect(
      Object.values(projection.occurrences).filter((value) => value.nodeId === "node"),
    ).toHaveLength(2);
    expect(projection.occurrences.occurrence?.parentNodeId).toBe("workspace");
    expect(projection.occurrences.reference?.parentNodeId).toBe("reference-parent");
  });

  it("MODEL-3 stored structure stays valid across projection cycles", () => {
    const facts = base();
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "self-reference",
      nodeId: "node",
      parentNodeId: "node",
      anchor: end,
    });
    facts.add({
      kind: "occurrence-move",
      occurrenceId: "occurrence",
      parentNodeId: "node",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.occurrences.occurrence?.parentNodeId).toBe("workspace");
    expect(projection.occurrences["self-reference"]?.parentNodeId).toBe("node");
  });

  it("MODEL-4 lifecycle restore is explicit and deletion-aware", () => {
    const facts = base();
    const deletion = facts.add({ kind: "node-delete", nodeId: "node" });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodes.node,
    ).toBeUndefined();

    facts.add({ kind: "node-restore", nodeId: "node", deletionFactId: deletion.id });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodes.node,
    ).toBeDefined();
    facts.add({ kind: "node-delete", nodeId: "node" });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodes.node,
    ).toBeUndefined();

    const occurrenceFacts = base();
    const firstDelete = occurrenceFacts.add({
      kind: "occurrence-delete",
      occurrenceId: "occurrence",
    });
    occurrenceFacts.add({
      kind: "occurrence-delete",
      occurrenceId: "occurrence",
    });
    occurrenceFacts.add({
      kind: "occurrence-restore",
      occurrenceId: "occurrence",
      deletionFactId: firstDelete.id,
      parentNodeId: "workspace",
      anchor: end,
    });
    occurrenceFacts.add({
      kind: "occurrence-create",
      occurrenceId: "occurrence",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    });
    expect(
      projectSnapshot("workspace", occurrenceFacts.snapshot(), "origin", versions).occurrences
        .occurrence,
    ).toBeUndefined();
  });
});
