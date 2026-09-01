import { describe, expect, it } from "vitest";

import { factActionId } from "../src/domain/fact/index.js";
import { canonicalJson, makeFact, type Fact, type FactFrontier, type GraphAction } from "../src/domain/fact/index.js";
import { rebuildGeneration, CURRENT_PROJECTION_VERSIONS as versions } from "../src/domain/reconcile/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import { snapshotOf } from "./support/facts.js";
import { shuffle } from "./support/permutation.js";

const moveReplicaB = "202";
const moveReplicaC = "303";
const unrelatedReplica = "404";
describe("Placement Conflict convergence", () => {
  it("preserves both cross-parent move intents across 32 Fact arrival orders", () => {
    const base = fixture();
    const baseSnapshot = snapshotOf(base.values);
    const frontier = baseSnapshot.frontier;
    const moveB = remoteMove(moveReplicaB, frontier, "parent-b");
    const moveC = remoteMove(moveReplicaC, frontier, "parent-c");
    const unrelated = remoteFact(unrelatedReplica, frontier, {
      kind: "rich-text-splice",
      nodeId: "unrelated",
      deleteAtomIds: [],
      anchor: end,
      insert: "x",
    });
    const expectedSnapshot = snapshotOf([...base.values, moveB, moveC, unrelated]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);

    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = snapshotOf(shuffle([...base.values, moveB, moveC, unrelated, moveB], seed));
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toBe(expectedSummary);
      const issue = Object.values(full.origin.conflictIssues)[0];
      expect(issue).toMatchObject({
        kind: "placement-conflict",
        occurrenceId: "value-occurrence",
        candidates: [
          { factActionId: factActionId(moveB.id, 0), parentNodeId: "parent-b" },
          { factActionId: factActionId(moveC.id, 0), parentNodeId: "parent-c" },
        ],
      });
      expect(full.review.conflictIssues).toEqual(full.origin.conflictIssues);
      expect(full.review.occurrences["value-occurrence"]?.parentNodeId).toBe(
        full.origin.occurrences["value-occurrence"]?.parentNodeId,
      );
    }
  });

  it("keeps concurrent Original promotions explicit while projecting one canonical graph", () => {
    const base = fixture();
    base.add({
      kind: "node-create",
      nodeId: "supertag-a",
      ownerNodeId: "workspace",
      originalPlacement: null,
      intrinsicNodeType: "supertag-definition",
    });
    base.add({
      kind: "node-create",
      nodeId: "supertag-b",
      ownerNodeId: "workspace",
      originalPlacement: null,
      intrinsicNodeType: "supertag-definition",
    });
    base.add({
      kind: "placement-create",
      placementId: "value-reference-b",
      nodeId: "value",
      parentNodeId: "parent-b",
      anchor: end,
    });
    base.add({
      kind: "placement-create",
      placementId: "value-reference-c",
      nodeId: "value",
      parentNodeId: "parent-c",
      anchor: end,
    });
    const snapshot = snapshotOf(base.values);
    const promoteB = remoteFact(moveReplicaB, snapshot.frontier, {
      kind: "original-promote",
      nodeId: "value",
      placementId: "value-reference-b",
    });
    const promoteC = remoteFact(moveReplicaC, snapshot.frontier, {
      kind: "original-promote",
      nodeId: "value",
      placementId: "value-reference-c",
    });

    for (let seed = 1; seed <= 16; seed += 1) {
      const generation = rebuildGeneration(
        "workspace",
        snapshotOf(shuffle([...base.values, promoteB, promoteC], seed)),
        versions,
      );
      const issue = Object.values(generation.origin.conflictIssues).find(
        (candidate) => candidate.kind === "original-conflict",
      );
      expect(issue).toMatchObject({
        kind: "original-conflict",
        nodeId: "value",
        candidates: [
          { factActionId: factActionId(promoteB.id, 0), placementId: "value-reference-b" },
          { factActionId: factActionId(promoteC.id, 0), placementId: "value-reference-c" },
        ],
      });
      expect(generation.review.conflictIssues).toEqual(generation.origin.conflictIssues);
    }

    const conflictSnapshot = snapshotOf([...base.values, promoteB, promoteC]);
    const extension = remoteFact(unrelatedReplica, conflictSnapshot.frontier, {
      kind: "supertag-extension-add",
      supertagId: "supertag-a",
      baseSupertagId: "supertag-b",
      anchor: end,
    });
    const finalSnapshot = snapshotOf([...conflictSnapshot.facts, extension]);
    expect(rebuildGeneration("workspace", finalSnapshot, versions).origin.conflictIssues).toEqual(
      rebuildGeneration("workspace", conflictSnapshot, versions).origin.conflictIssues,
    );
  });
});

function fixture(): Facts {
  const facts = new Facts();
  for (const suffix of ["b", "c"]) {
    facts.addPlaced(`parent-${suffix}`, "workspace", `parent-${suffix}-occurrence`);
  }
  facts.addPlaced("value", "workspace", "value-occurrence");
  facts.addPlaced("unrelated", "value");
  return facts;
}

function remoteMove(replicaId: string, observed: FactFrontier, parentNodeId: string): Fact {
  return remoteFact(replicaId, observed, {
    kind: "placement-move",
    placementId: "value-occurrence",
    parentNodeId,
    anchor: end,
  });
}

function remoteFact(replicaId: string, observed: FactFrontier, authoredAction: GraphAction): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence: 1,
    observed,
    lamport: Object.values(observed).reduce((maximum, value) => Math.max(maximum, value), 0) + 1,
    body: { kind: "action", actorId: replicaId, intent: "direct", actions: [authoredAction] },
  });
}

function summary(result: ReturnType<typeof rebuildGeneration> | null): string {
  if (!result) {
    throw new Error("Expected Placement Conflict Reconcile result");
  }
  return canonicalJson(result);
}
