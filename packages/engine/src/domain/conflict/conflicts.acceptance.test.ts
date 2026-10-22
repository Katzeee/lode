import { describe, expect, it } from "vitest";
import { uniqueFacts } from "../../../tests/support/facts.js";
import { buildFactSnapshot } from "../fact/index.js";
import { factActionId, makeFact, type FactSnapshot, type SequenceAnchor } from "../fact/index.js";
import { frontierOf } from "../fact/frontier.js";
import { rebuildGeneration } from "../reconcile/index.js";
import { projectionText } from "../../../tests/support/reconcile/projection.js";
import {
  base,
  REPLICA_A,
  REPLICA_B,
  REPLICA_C,
  remoteFact,
  versions,
  end,
} from "../../../tests/support/review/review-test-helpers.js";
import { resolutionAdjudicationProblem } from "./conflicts.js";

const REPLICA_D = "404";

describe("Conflict lifecycle", () => {
  it("queries opposite Resolutions with provenance and clears them through adjudication", () => {
    const facts = base();
    const proposal = facts.add(
      {
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "P",
      },
      "proposal",
    );
    const observed = { [REPLICA_A]: facts.values.length };
    const accept = remoteFact({
      replicaId: REPLICA_B,
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "accept-reviewer",
        decision: "accept",
        proposalFactIds: [proposal.factId],
      },
    });
    const reject = remoteFact({
      replicaId: REPLICA_C,
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [],
        actorId: "reject-reviewer",
        decision: "reject",
        proposalFactIds: [proposal.factId],
      },
    });
    const conflicted = facts.snapshot([accept, reject]);
    const conflictedGeneration = rebuildGeneration("workspace", conflicted, versions);

    const issues = Object.values(conflictedGeneration.review.conflictIssues);
    expect(issues[0]?.identity).toMatch(/^\["resolution-conflict"/);
    expect(issues).toEqual([
      {
        kind: "resolution-conflict",
        identity: issues[0]?.identity,
        proposalFactIds: [proposal.factId],
        candidates: [
          {
            resolutionId: accept.id,
            decision: "accept",
            actorId: "accept-reviewer",
            replicaId: REPLICA_B,
            observedFrontier: observed,
          },
          {
            resolutionId: reject.id,
            decision: "reject",
            actorId: "reject-reviewer",
            replicaId: REPLICA_C,
            observedFrontier: observed,
          },
        ],
      },
    ]);
    expect(resolutionAdjudicationProblem(conflicted, [proposal.factId], [accept.id, reject.id])).toBeNull();

    const adjudication = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA_D,
      sequence: 1,
      observed: conflicted.frontier,
      lamport: facts.values.length + 2,
      body: {
        kind: "resolution",
        adjudicatesResolutionIds: [accept.id, reject.id],
        actorId: "adjudicator",
        decision: "accept",
        proposalFactIds: [proposal.factId],
      },
    });
    const interpretation = buildFactSnapshot("workspace", uniqueFacts([...conflicted.facts, adjudication]));
    const terminal = rebuildGeneration("workspace", interpretation, versions);
    expect(projectionText(terminal.origin, "node")).toBe("P");
    expect(Object.values(terminal.review.conflictIssues)).toEqual([]);
    expect(frontierOf(interpretation.facts)).toEqual(interpretation.frontier);
  });

  it("surfaces concurrent cross-parent moves and clears them through an observed move", () => {
    const facts = base();
    for (const suffix of ["b", "c"]) {
      facts.addPlaced(`parent-${suffix}`, "workspace", `parent-${suffix}-occurrence`);
    }
    const observed = { [REPLICA_A]: facts.values.length };
    const moveB = remoteFact({
      replicaId: REPLICA_B,
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "action",
        actorId: "mover-b",
        intent: "direct",
        actions: [
          {
            kind: "placement-move",
            placementId: "occurrence",
            parentNodeId: "parent-b",
            anchor: end,
          },
        ],
      },
    });
    const moveC = remoteFact({
      replicaId: REPLICA_C,
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "action",
        actorId: "mover-c",
        intent: "direct",
        actions: [
          {
            kind: "placement-move",
            placementId: "occurrence",
            parentNodeId: "parent-c",
            anchor: end,
          },
        ],
      },
    });
    const conflicted = interpreted(facts.snapshot([moveB, moveC]));
    const generation = rebuildGeneration("workspace", conflicted, versions);
    const issue = Object.values(generation.review.conflictIssues)[0];
    expect(issue).toMatchObject({
      kind: "placement-conflict",
      occurrenceId: "occurrence",
      candidates: [
        { factActionId: factActionId(moveB.id, 0), parentNodeId: "parent-b", actorId: "mover-b" },
        { factActionId: factActionId(moveC.id, 0), parentNodeId: "parent-c", actorId: "mover-c" },
      ],
    });
    if (!issue || issue.kind !== "placement-conflict") {
      throw new Error("Expected Placement Conflict");
    }
    expect(["parent-b", "parent-c"]).toContain(issue.canonicalParentNodeId);

    const currentParent = generation.origin.occurrences.occurrence?.parentNodeId;
    if (!currentParent) {
      throw new Error("Expected occurrence to have a parent Node");
    }
    const resolution = remoteFact({
      replicaId: REPLICA_D,
      observed: conflicted.frontier,
      lamport: facts.values.length + 2,
      body: {
        kind: "action",
        actorId: "resolver",
        intent: "direct",
        actions: [
          {
            kind: "placement-move",
            placementId: "occurrence",
            parentNodeId: "parent-b",
            anchor: end,
          },
        ],
      },
    });
    const resolved = interpreted({
      facts: [...conflicted.facts, resolution],
      frontier: frontierOf([...conflicted.facts, resolution]),
    });
    const terminal = rebuildGeneration("workspace", resolved, versions);
    expect(terminal.origin.occurrences.occurrence?.parentNodeId).toBe("parent-b");
    expect(Object.values(terminal.review.conflictIssues)).toEqual([]);
  });

  it("keeps concurrent same-parent reorders as a convergent sequence choice", () => {
    const facts = base();
    facts.addPlaced("parent", "workspace", "parent-occurrence");
    for (const identity of ["left", "right"]) {
      facts.addPlaced(identity, "parent", identity);
    }
    const observed = { [REPLICA_A]: facts.values.length };
    const move = (replicaId: string, anchor: SequenceAnchor) =>
      remoteFact({
        replicaId,
        observed,
        lamport: facts.values.length + 1,
        body: {
          kind: "action",
          actorId: replicaId,
          intent: "direct",
          actions: [
            {
              kind: "placement-move",
              placementId: "occurrence",
              parentNodeId: "parent",
              anchor,
            },
          ],
        },
      });
    const snapshot = interpreted(
      facts.snapshot([
        move(REPLICA_B, { after: null, before: "left", affinity: "before", fallback: "start" }),
        move(REPLICA_C, { after: "right", before: null, affinity: "after", fallback: "end" }),
      ]),
    );
    const generation = rebuildGeneration("workspace", snapshot, versions);
    expect(generation.origin.occurrences.occurrence?.parentNodeId).toBe("parent");
    expect(generation.origin.childOccurrences.parent).toContain("occurrence");
    expect(Object.values(generation.review.conflictIssues)).toEqual([]);
  });
});

function interpreted(snapshot: FactSnapshot) {
  const interpretation = buildFactSnapshot("workspace", uniqueFacts(snapshot.facts));
  return interpretation;
}
