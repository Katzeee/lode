import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../admission/index.js";
import { frontierOf, makeFact, type FactSnapshot, type SequenceAnchor } from "../fact/index.js";
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

const REPLICA_D = "dddddddddddddddddddddddddd";

describe("Conflict lifecycle", () => {
  it("queries opposite Resolutions with provenance and clears them through adjudication", () => {
    const facts = base();
    const proposal = facts.add(
      {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        deletedAtoms: [],
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
        proposalContributionIds: [proposal.id],
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
        proposalContributionIds: [proposal.id],
      },
    });
    const conflicted = facts.snapshot([accept, reject]);
    const conflictedGeneration = rebuildGeneration("workspace", conflicted, versions).generation;

    const issues = Object.values(conflictedGeneration.review.conflictIssues);
    expect(issues[0]?.identity).toMatch(/^\["resolution-conflict"/);
    expect(issues).toEqual([
      {
        kind: "resolution-conflict",
        identity: issues[0]?.identity,
        proposalContributionIds: [proposal.id],
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
    expect(resolutionAdjudicationProblem(conflicted, [proposal.id], [accept.id, reject.id])).toBeNull();

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
        proposalContributionIds: [proposal.id],
      },
    });
    const records = [...conflicted.facts, adjudication].map((fact) => ({
      recordKind: "fact" as const,
      fact,
    }));
    const admission = admitAuthorityRecords("workspace", records);
    expect(admission.kind).toBe("ready");
    const terminal = rebuildGeneration("workspace", admission.snapshot, versions).generation;
    expect(projectionText(terminal.origin, "node")).toBe("P");
    expect(Object.values(terminal.review.conflictIssues)).toEqual([]);
    expect(frontierOf(admission.snapshot.facts)).toEqual(admission.snapshot.frontier);
  });

  it("surfaces concurrent cross-parent moves and clears them through an observed move", () => {
    const facts = base();
    for (const suffix of ["b", "c"]) {
      facts.addPlaced(`parent-${suffix}`, "workspace", `parent-${suffix}-occurrence`);
    }
    const observed = { [REPLICA_A]: facts.values.length };
    const previousAnchor = {
      after: "workspace-trash-occ:v1:workspace",
      before: "parent-b-occurrence",
      affinity: "after",
      fallback: "end",
    } as const;
    const moveB = remoteFact({
      replicaId: REPLICA_B,
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "contribution",
        actorId: "mover-b",
        intent: "direct",
        mutation: {
          kind: "occurrence-move",
          occurrenceId: "occurrence",
          parentNodeId: "parent-b",
          anchor: end,
          previousParentNodeId: "workspace",
          previousAnchor,
        },
      },
    });
    const moveC = remoteFact({
      replicaId: REPLICA_C,
      observed,
      lamport: facts.values.length + 1,
      body: {
        kind: "contribution",
        actorId: "mover-c",
        intent: "direct",
        mutation: {
          kind: "occurrence-move",
          occurrenceId: "occurrence",
          parentNodeId: "parent-c",
          anchor: end,
          previousParentNodeId: "workspace",
          previousAnchor,
        },
      },
    });
    const conflicted = admitted(facts.snapshot([moveB, moveC]));
    const generation = rebuildGeneration("workspace", conflicted, versions).generation;
    const issue = Object.values(generation.review.conflictIssues)[0];
    expect(issue).toMatchObject({
      kind: "placement-conflict",
      occurrenceId: "occurrence",
      candidates: [
        { contributionId: moveB.id, parentNodeId: "parent-b", actorId: "mover-b" },
        { contributionId: moveC.id, parentNodeId: "parent-c", actorId: "mover-c" },
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
    const siblings = generation.origin.childOccurrences[currentParent] ?? [];
    const index = siblings.indexOf("occurrence");
    const resolution = remoteFact({
      replicaId: REPLICA_D,
      observed: conflicted.frontier,
      lamport: facts.values.length + 2,
      body: {
        kind: "contribution",
        actorId: "resolver",
        intent: "direct",
        mutation: {
          kind: "occurrence-move",
          occurrenceId: "occurrence",
          parentNodeId: "parent-b",
          anchor: end,
          previousParentNodeId: currentParent,
          previousAnchor: {
            after: siblings[index - 1] ?? null,
            before: siblings[index + 1] ?? null,
            affinity: "after",
            fallback: index <= 0 ? "start" : "end",
          },
        },
      },
    });
    const resolved = admitted({
      facts: [...conflicted.facts, resolution],
      frontier: frontierOf([...conflicted.facts, resolution]),
    });
    const terminal = rebuildGeneration("workspace", resolved, versions).generation;
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
          kind: "contribution",
          actorId: replicaId,
          intent: "direct",
          mutation: {
            kind: "occurrence-move",
            occurrenceId: "occurrence",
            parentNodeId: "parent",
            anchor,
            previousParentNodeId: "workspace",
            previousAnchor: {
              after: "workspace-trash-occ:v1:workspace",
              before: "parent-occurrence",
              affinity: "after",
              fallback: "end",
            },
          },
        },
      });
    const snapshot = admitted(
      facts.snapshot([
        move(REPLICA_B, { after: null, before: "left", affinity: "before", fallback: "start" }),
        move(REPLICA_C, { after: "right", before: null, affinity: "after", fallback: "end" }),
      ]),
    );
    const generation = rebuildGeneration("workspace", snapshot, versions).generation;
    expect(generation.origin.occurrences.occurrence?.parentNodeId).toBe("parent");
    expect(generation.origin.childOccurrences.parent).toContain("occurrence");
    expect(Object.values(generation.review.conflictIssues)).toEqual([]);
  });
});

function admitted(snapshot: FactSnapshot) {
  const admission = admitAuthorityRecords(
    "workspace",
    snapshot.facts.map((fact) => ({ recordKind: "fact" as const, fact })),
  );
  if (admission.kind === "fault") {
    throw new Error(admission.fault ?? "Conflict fixture admission failed");
  }
  return admission.snapshot;
}
