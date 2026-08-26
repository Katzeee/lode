import { describe, expect, it } from "vitest";

import { queryReview } from "./review.js";
import { base, end, generation } from "../../../tests/support/review/review-test-helpers.js";

describe("production Review contracts", () => {
  it("REVIEW-1 hunks are derived typed net differences", () => {
    const facts = base();
    const proposal = facts.add(
      {
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "proposal",
      },
      "proposal",
    );
    const snapshot = facts.snapshot();
    const review = queryReview(snapshot, generation(snapshot));

    expect(review.hunks).toHaveLength(1);
    expect(review.hunks[0]).toMatchObject({
      diffSpace: { kind: "node-content", identity: "node" },
      selection: { proposalActionIds: [proposal.id] },
    });
    expect(snapshot).not.toHaveProperty("hunks");
  });

  it("REVIEW-2 selection identifies the complete Proposal action closure", () => {
    const facts = base();
    const created = facts.addPlaced("proposal-node", "workspace", "proposal-occurrence", "proposal");
    const [node] = created;
    if (!node) {
      throw new Error("Expected a Node creation FactAction");
    }
    const snapshot = facts.snapshot();
    const hunk = queryReview(snapshot, generation(snapshot)).hunks.find((candidate) =>
      candidate.selection.proposalActionIds.includes(node.id),
    );

    expect(hunk?.selection.proposalActionIds).toEqual([node.id]);
  });
});
