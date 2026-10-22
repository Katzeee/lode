import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  makeFact,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  type Fact,
  type FactFrontier,
  type GraphAction,
} from "../src/domain/fact/index.js";
import { rebuildGeneration, CURRENT_PROJECTION_VERSIONS as versions } from "../src/domain/reconcile/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import { addDefinitionNode } from "./support/reconcile/placed-node-test-helpers.js";
import { snapshotOf } from "./support/facts.js";
import { shuffle } from "./support/permutation.js";

const deleteReplica = "202";
const insertReplica = "303";
const unrelatedReplica = "404";
const restoreReplica = "505";
const FIELD_NODE_ID = materializedFieldNodeId("owner", "field-definition");
const FIELD_OCCURRENCE_ID = materializedFieldOccurrenceId("owner", "field-definition");

describe("Field content deletion convergence", () => {
  it("converges concurrent same-Field value reorders across 32 Fact arrival orders", () => {
    const base = orderingFixture();
    const baseSnapshot = snapshotOf(base.values);
    const moveC = remoteFact(insertReplica, baseSnapshot.frontier, {
      kind: "placement-move",
      placementId: "value-c-occurrence",
      parentNodeId: FIELD_NODE_ID,
      anchor: {
        after: "field-definition-endpoint-occ:v1:field-occurrence",
        before: "value-a-occurrence",
        affinity: "before",
        fallback: "start",
      },
    });
    const moveB = remoteFact(unrelatedReplica, baseSnapshot.frontier, {
      kind: "placement-move",
      placementId: "value-b-occurrence",
      parentNodeId: FIELD_NODE_ID,
      anchor: {
        after: "field-definition-endpoint-occ:v1:field-occurrence",
        before: "value-a-occurrence",
        affinity: "before",
        fallback: "start",
      },
    });
    const expectedSnapshot = snapshotOf([...base.values, moveC, moveB]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);
    const expectedOrder = expected.origin.materializedFields.owner?.[0]?.valueOccurrenceIds;
    expect(new Set(expectedOrder)).toEqual(new Set(["value-a-occurrence", "value-b-occurrence", "value-c-occurrence"]));

    for (let seed = 65; seed <= 96; seed += 1) {
      const snapshot = snapshotOf(shuffle([...base.values, moveB, moveC, moveB, moveC], seed));
      expect(summary(rebuildGeneration("workspace", snapshot, versions))).toBe(expectedSummary);
    }
  });

  it("preserves a concurrent new value while deleting only the selected value across 32 topologies", () => {
    const base = fixture();
    const baseSnapshot = snapshotOf(base.values);
    const deletion = remoteDeletion(deleteReplica, baseSnapshot.frontier, {
      kind: "field-value-remove",
      valuePlacementId: "value-a-occurrence",
    });
    const insertion = remoteFact(insertReplica, baseSnapshot.frontier, {
      kind: "placement-create",
      placementId: "value-c-occurrence",
      nodeId: "value-c",
      parentNodeId: FIELD_NODE_ID,
      anchor: end,
    });
    const unrelated = remoteFact(unrelatedReplica, baseSnapshot.frontier, {
      kind: "rich-text-splice",
      nodeId: "unrelated",
      deleteAtomIds: [],
      anchor: end,
      insert: "independent",
    });
    const expectedSnapshot = snapshotOf([...base.values, ...deletion, insertion, unrelated]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);

    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = snapshotOf(shuffle([...base.values, insertion, ...deletion, unrelated, ...deletion], seed));
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toBe(expectedSummary);
      expect(full.origin.materializedFields.owner?.[0]?.valueOccurrenceIds).toEqual([
        "value-b-occurrence",
        "value-c-occurrence",
      ]);
      expect(full.origin.occurrences["value-a-occurrence"]).toBeUndefined();
      expect(full.origin.nodes["value-a"]).toBeDefined();
      expect(full.review).toEqual({ ...full.origin, perspective: "review" });
    }
  });

  it("restores the full Field subtree including a concurrently authored value", () => {
    const base = fixture();
    const baseSnapshot = snapshotOf(base.values);
    const deletion = remoteDeletion(deleteReplica, baseSnapshot.frontier, {
      kind: "materialized-field-clear",
      ownerNodeId: "owner",
      fieldDefinitionId: "field-definition",
    });
    const insertion = remoteFact(insertReplica, baseSnapshot.frontier, {
      kind: "placement-create",
      placementId: "value-c-occurrence",
      nodeId: "value-c",
      parentNodeId: FIELD_NODE_ID,
      anchor: end,
    });
    const merged = snapshotOf([...base.values, ...deletion, insertion]);
    const hidden = rebuildGeneration("workspace", merged, versions).origin;
    expect(hidden.materializedFields.owner).toBeUndefined();
    expect(hidden.nodes[FIELD_NODE_ID]).toBeDefined();
    expect(hidden.nodes["value-a"]).toBeDefined();
    expect(hidden.nodes["value-b"]).toBeDefined();
    expect(hidden.nodes["value-c"]).toBeDefined();
    expect(merged.facts.some((fact) => fact.id === insertion.id)).toBe(true);
    const restoration = remoteTransaction(
      restoreReplica,
      merged.frontier,
      [
        {
          kind: "placement-create",
          nodeId: FIELD_NODE_ID,
          placementId: FIELD_OCCURRENCE_ID,
          parentNodeId: "owner",
          anchor: { ...end, fallback: "start" },
        },
      ],
      Math.max(...merged.facts.map((fact) => fact.coordinate.lamport)) + 1,
    );
    const expectedSnapshot = snapshotOf([...base.values, ...deletion, insertion, ...restoration]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);

    for (let seed = 33; seed <= 64; seed += 1) {
      const snapshot = snapshotOf(shuffle([...base.values, insertion, ...restoration, ...deletion, insertion], seed));
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toBe(expectedSummary);
      expect(full.origin.materializedFields.owner?.[0]?.valueOccurrenceIds).toEqual([
        "value-a-occurrence",
        "value-b-occurrence",
        "value-c-occurrence",
      ]);
      expect(full.origin.nodes["value-a"]).toBeDefined();
      expect(full.origin.nodes["value-b"]).toBeDefined();
      expect(full.origin.nodes["value-c"]).toBeDefined();
    }
  });
});

function fixture(): Facts {
  const facts = new Facts();
  addDefinitionNode(facts, "field-definition", "field-definition");
  facts.addPlaced("owner", "workspace", "owner-occurrence");
  facts.addPlaced(FIELD_NODE_ID, "owner", FIELD_OCCURRENCE_ID);
  facts.addPlaced("value-a", FIELD_NODE_ID, "value-a-occurrence");
  facts.addPlaced("value-b", FIELD_NODE_ID, "value-b-occurrence");
  facts.addPlaced("value-c", "workspace");
  facts.addPlaced("unrelated", "workspace");
  facts.add({
    kind: "field-materialize",
    ownerNodeId: "owner",
    fieldDefinitionId: "field-definition",
  });
  return facts;
}

function orderingFixture(): Facts {
  const facts = new Facts();
  addDefinitionNode(facts, "field-definition", "field-definition");
  facts.addPlaced("owner", "workspace", "owner-occurrence");
  facts.addPlaced(FIELD_NODE_ID, "owner", FIELD_OCCURRENCE_ID);
  facts.addPlaced("value-a", FIELD_NODE_ID, "value-a-occurrence");
  facts.addPlaced("value-b", FIELD_NODE_ID, "value-b-occurrence");
  facts.addPlaced("value-c", FIELD_NODE_ID, "value-c-occurrence");
  facts.add({
    kind: "field-materialize",
    ownerNodeId: "owner",
    fieldDefinitionId: "field-definition",
  });
  return facts;
}

function remoteFact(
  replicaId: string,
  observed: FactFrontier,
  authoredAction: GraphAction,
  lamport = Math.max(...Object.values(observed)) + 1,
): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence: 1,
    observed,
    lamport,
    body: { kind: "action", actorId: replicaId, intent: "direct", actions: [authoredAction] },
  });
}

function remoteDeletion(
  replicaId: string,
  observed: FactFrontier,
  authoredAction: Extract<GraphAction, { kind: "field-value-remove" | "materialized-field-clear" }>,
): readonly Fact[] {
  return remoteTransaction(replicaId, observed, [authoredAction]);
}

function remoteTransaction(
  replicaId: string,
  observed: FactFrontier,
  actions: readonly GraphAction[],
  firstLamport = Math.max(...Object.values(observed)) + 1,
): readonly Fact[] {
  const [first, ...rest] = actions;
  return first
    ? [
        makeFact({
          workspaceId: "workspace",
          replicaId,
          sequence: 1,
          observed,
          lamport: firstLamport,
          body: { kind: "action", actorId: replicaId, intent: "direct", actions: [first, ...rest] },
        }),
      ]
    : [];
}

function summary(result: ReturnType<typeof rebuildGeneration> | null): string {
  if (!result) {
    throw new Error("Expected Field content deletion Reconcile result");
  }
  return canonicalJson(result);
}
