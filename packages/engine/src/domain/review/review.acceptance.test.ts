import { describe, expect, it } from "vitest";

import { queryReview } from "./review.js";
import { base, end, generation } from "../../../tests/support/review/review-test-helpers.js";

describe("production Review contracts", () => {
  it("REVIEW-1 hunks are derived typed net differences", () => {
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
    const snapshot = facts.snapshot();
    const review = queryReview("workspace", snapshot, generation(snapshot));

    expect(review.hunks).toHaveLength(1);
    expect(review.hunks[0]).toMatchObject({
      diffSpace: { kind: "node-content", identity: "node" },
      proposalContributionIds: [proposal.id],
    });
    expect(snapshot).not.toHaveProperty("hunks");
  });

  it("REVIEW-2 scope is visible targets plus minimal support closure", () => {
    const facts = base();
    const created = facts.addPlaced("proposal-node", "workspace", "proposal-occurrence", "proposal");
    const [node, occurrence] = created;
    if (!node || !occurrence) {
      throw new Error("Expected a Node creation transaction");
    }
    const snapshot = facts.snapshot();
    const hunk = queryReview("workspace", snapshot, generation(snapshot)).hunks.find((candidate) =>
      candidate.proposalContributionIds.includes(occurrence.id),
    );

    expect(hunk?.selection.evidence.supportClosure).toEqual([node.id, occurrence.id]);
  });
});
