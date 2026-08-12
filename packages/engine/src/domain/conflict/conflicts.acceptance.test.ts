import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../admission/index.js";
import { frontierOf, makeFact } from "../fact/index.js";
import { projectionText, rebuildGeneration } from "../reconcile/index.js";
import {
  base,
  REPLICA_A,
  REPLICA_B,
  REPLICA_C,
  remoteFact,
  versions,
  end,
} from "../review/review-test-helpers.js";
import { queryConflicts, resolutionAdjudicationProblem } from "./conflicts.js";

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

    const query = queryConflicts(conflicted, conflictedGeneration);
    expect(query.issues[0]?.identity).toMatch(/^\["resolution-conflict"/);
    expect(query.issues).toEqual([
      {
        kind: "resolution-conflict",
        identity: query.issues[0]?.identity,
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
    expect(
      resolutionAdjudicationProblem(conflicted, [proposal.id], [accept.id, reject.id]),
    ).toBeNull();

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
    expect(queryConflicts(admission.snapshot, terminal).issues).toEqual([]);
    expect(frontierOf(admission.snapshot.facts)).toEqual(admission.snapshot.frontier);
  });
});
