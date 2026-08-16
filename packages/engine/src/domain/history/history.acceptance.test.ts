import { describe, expect, it } from "vitest";

import { queryHistory } from "./history.js";
import { baseFixture, end } from "../../../tests/support/history/history-test-helpers.js";

describe("production History contracts", () => {
  it("accepted and rejected Proposal steps leave History instead of being compensated", () => {
    for (const decision of ["accept", "reject"] as const) {
      const fixture = baseFixture();
      const step = fixture.step({
        invocationId: `proposal-${decision}`,
        intent: "proposal",
        mutations: [
          {
            kind: "text-splice",
            nodeId: "node",
            deleteAtomIds: [],
            anchor: end,
            insert: decision,
          },
        ],
      });
      fixture.resolve(step.factIds, decision);

      expect(queryHistory("channel", fixture.receipts, fixture.snapshot(), fixture.generation()).undo).toBeNull();
    }
  });
});
