import { describe, expect, it } from "vitest";

import { frontierOf, makeFact } from "../fact/index.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
  validateGenerationCheckpoint,
} from "../../runtime/workspace/generation-checkpoint.js";
import { advanceGeneration, projectSnapshot, projectionText, rebuildGeneration } from "./index.js";
import { managedNodeId } from "./managed-identity.js";
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
      evaluatedOwners: ["activation", "text", "assembly"],
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

  it("incremental Direct value tails re-evaluate declared downstream and match a full rebuild", () => {
    const facts = fullSurface("direct");
    const before = facts.snapshot();
    const generation = rebuildGeneration("workspace", before, versions).generation;
    facts.add({
      kind: "value-set",
      owner: { kind: "schema", id: "schema" },
      namespace: "schema",
      key: "replacement",
      value: 1,
    });
    facts.add({
      kind: "value-unset",
      owner: { kind: "schema", id: "schema" },
      namespace: "schema",
      key: "field",
      previous: { kind: "set", value: 0 },
    });
    const after = facts.snapshot();
    const incremental = advanceGeneration("workspace", before, after, versions, generation);

    expect(incremental.generation).toEqual(
      rebuildGeneration("workspace", after, versions).generation,
    );
    expect(incremental.stats.evaluatedOwners).toEqual([
      "activation",
      "value",
      "schema",
      "text",
      "assembly",
    ]);
    expect(incremental.generation.origin.managedChildren[0]?.fieldId).toBe("replacement");
  });

  it("managed Field lifecycle tails preserve existing text across inactive, active, and Schema states", () => {
    const facts = fullSurface("direct");
    const schemaChild = managedNodeId("node", "schema", "field");
    facts.add({
      kind: "text-splice",
      nodeId: schemaChild,
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "X",
    });

    const advanceAndCompare = (tail: () => void) => {
      const before = facts.snapshot();
      const generation = rebuildGeneration("workspace", before, versions).generation;
      const checkpoint = createGenerationCheckpoint(
        "workspace",
        before,
        generation,
        CHECKPOINT_KEY,
      );
      tail();
      const after = facts.snapshot();
      const incremental = advanceGeneration("workspace", before, after, versions, generation);
      const full = rebuildGeneration("workspace", after, versions);
      const checkpointTail = reconcileFromCheckpoint(
        checkpoint,
        "workspace",
        after,
        versions,
        CHECKPOINT_KEY,
      );

      expect(incremental.generation).toEqual(full.generation);
      expect(checkpointTail?.generation).toEqual(full.generation);
      return incremental.generation;
    };

    const inactive = advanceAndCompare(() => {
      facts.add({
        kind: "value-unset",
        owner: { kind: "schema", id: "schema" },
        namespace: "schema",
        key: "field",
        previous: { kind: "set", value: 0 },
      });
    });
    expect(projectionText(inactive.origin, schemaChild)).toBe("X");
    expect(inactive.origin.managedChildren).toEqual([]);

    const activeAgain = advanceAndCompare(() => {
      facts.add({
        kind: "value-set",
        owner: { kind: "schema", id: "schema" },
        namespace: "schema",
        key: "field",
        value: 0,
        previous: { kind: "unset" },
      });
    });
    expect(projectionText(activeAgain.origin, schemaChild)).toBe("X");
    expect(activeAgain.origin.managedChildren.map((child) => child.nodeId)).toContain(schemaChild);

    facts.add({
      kind: "value-set",
      owner: { kind: "schema", id: "second-schema" },
      namespace: "schema",
      key: "second-field",
      value: 0,
      previous: { kind: "unset" },
    });
    const switched = advanceAndCompare(() => {
      facts.add({
        kind: "value-set",
        owner: { kind: "node", id: "node" },
        namespace: "property",
        key: "schemaId",
        value: "second-schema",
        previous: { kind: "set", value: "schema" },
      });
    });
    expect(projectionText(switched.origin, schemaChild)).toBe("X");
    expect(switched.origin.managedChildren.map((child) => child.nodeId)).toEqual([
      managedNodeId("node", "second-schema", "second-field"),
    ]);
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
                parentOccurrenceId: null,
                parentPolicy: "cascade",
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
                childPolicy: "cascade",
                previousParentOccurrenceId: null,
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
            childPolicy: "cascade",
            previousParentOccurrenceId: null,
            previousAnchor: { after: null, before: null, affinity: "after", fallback: "start" },
          });
          return {
            facts,
            tail: () => {
              facts.add({
                kind: "occurrence-restore",
                occurrenceId: "occurrence",
                deletionFactId: deletion.id,
                parentOccurrenceId: null,
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
          facts.add({
            kind: "occurrence-create",
            occurrenceId: "parent",
            nodeId: "node",
            parentOccurrenceId: null,
            parentPolicy: "cascade",
            anchor: end,
          });
          return {
            facts,
            tail: () => {
              facts.add({
                kind: "occurrence-move",
                occurrenceId: "occurrence",
                parentOccurrenceId: "parent",
                anchor: end,
                previousParentOccurrenceId: null,
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
      expect(incremental.stats.evaluatedOwners, testCase.name).not.toContain("value");
      expect(incremental.stats.evaluatedOwners, testCase.name).not.toHaveLength(8);
    }
  });

  it("incremental schema and field tails retain previously materialized addressed values", () => {
    const facts = base();
    for (const [key, value] of [
      ["a", 1],
      ["b", 2],
    ] as const) {
      facts.add({
        kind: "value-set",
        owner: { kind: "schema", id: "schema" },
        namespace: "schema",
        key,
        value,
      });
    }
    const before = facts.snapshot();
    const generation = rebuildGeneration("workspace", before, versions).generation;
    facts.add({
      kind: "value-set",
      owner: { kind: "schema", id: "schema" },
      namespace: "schema",
      key: "c",
      value: 3,
    });

    const after = facts.snapshot();
    const incremental = advanceGeneration("workspace", before, after, versions, generation);
    const full = rebuildGeneration("workspace", after, versions);

    expect(incremental.generation).toEqual(full.generation);
    expect(incremental.generation.origin.addressedValues["schema/schema/schema"]).toEqual({
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
    expect(proposalProjection.canonicalOccurrences).toEqual(directProjection.canonicalOccurrences);
  });

  it("MODEL-2 node and occurrence ownership preserves transclusion", () => {
    const facts = base();
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
      parentOccurrenceId: null,
      parentPolicy: "cascade",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projectionText(projection, "node")).toBe("shared");
    expect(
      Object.values(projection.occurrences).filter((value) => value.nodeId === "node"),
    ).toHaveLength(2);
    expect(projection.occurrences.occurrence?.parentOccurrenceId).toBeNull();
    expect(projection.occurrences.reference?.parentOccurrenceId).toBeNull();
  });

  it("MODEL-3 stored structure stays valid across projection cycles", () => {
    const facts = base();
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "self-reference",
      nodeId: "node",
      parentOccurrenceId: "occurrence",
      parentPolicy: "cascade",
      anchor: end,
    });
    facts.add({
      kind: "occurrence-move",
      occurrenceId: "occurrence",
      parentOccurrenceId: "self-reference",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.occurrences.occurrence?.parentOccurrenceId).toBeNull();
    expect(projection.occurrences["self-reference"]?.parentOccurrenceId).toBe("occurrence");
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
      childPolicy: "rehome",
    });
    occurrenceFacts.add({
      kind: "occurrence-delete",
      occurrenceId: "occurrence",
      childPolicy: "rehome",
    });
    occurrenceFacts.add({
      kind: "occurrence-restore",
      occurrenceId: "occurrence",
      deletionFactId: firstDelete.id,
      parentOccurrenceId: null,
      anchor: end,
    });
    occurrenceFacts.add({
      kind: "occurrence-create",
      occurrenceId: "occurrence",
      nodeId: "node",
      parentOccurrenceId: null,
      parentPolicy: "cascade",
      anchor: end,
    });
    expect(
      projectSnapshot("workspace", occurrenceFacts.snapshot(), "origin", versions).occurrences
        .occurrence,
    ).toBeUndefined();
  });
});
