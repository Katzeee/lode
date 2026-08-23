import { describe, expect, it } from "vitest";

import { queryHistory, validateHistorySelection } from "./history.js";
import { baseFixture, end } from "../../../tests/support/history/history-test-helpers.js";

describe("production History contracts", () => {
  it("accepted and rejected Proposal steps leave History instead of being compensated", () => {
    for (const decision of ["accept", "reject"] as const) {
      const fixture = baseFixture();
      const step = fixture.step({
        invocationId: `proposal-${decision}`,
        intent: "proposal",
        actions: [
          {
            kind: "rich-text-splice",
            nodeId: "node",
            deleteAtomIds: [],
            anchor: end,
            insert: decision,
          },
        ],
      });
      fixture.resolve(step.factIds, decision);

      const selection = queryHistory("channel", fixture.receipts).undo;
      expect(selection).not.toBeNull();
      expect(
        validateHistorySelection(selection!, fixture.receipts, fixture.snapshot(), fixture.generation()).kind,
      ).toBe("stale");
    }
  });
});
