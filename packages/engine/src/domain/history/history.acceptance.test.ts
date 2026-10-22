import { describe, expect, it } from "vitest";

import { queryHistory, validateHistorySelection } from "./history.js";
import { baseFixture, end } from "../../../tests/support/history/history-test-helpers.js";
import { projectionText } from "../../../tests/support/reconcile/projection.js";

describe("production History contracts", () => {
  it("undoing a restore then its earlier deletion returns the Original without losing another writer's text", () => {
    const fixture = baseFixture();
    fixture.fact({ kind: "node-create", nodeId: "destination", ownerNodeId: "workspace", originalPlacement: null });
    fixture.step({ invocationId: "cut", actions: [{ kind: "node-trash", nodeId: "node" }] });
    fixture.step({
      invocationId: "paste",
      actions: [
        { kind: "node-restore", nodeId: "node", placementId: "occurrence", parentNodeId: "destination", anchor: end },
      ],
    });
    fixture.step({
      invocationId: "other-writer",
      channelId: "other",
      actions: [
        { kind: "rich-text-splice", nodeId: "node", deleteAtomIds: [], anchor: end, insert: "Shared later text" },
      ],
    });
    for (const target of ["paste", "cut"]) {
      const selection = queryHistory("channel", fixture.snapshot()).undo!;
      const plan = validateHistorySelection("undo", selection, fixture.snapshot(), fixture.generation());
      expect(plan.kind).toBe("ready");
      if (plan.kind !== "ready") {
        throw new Error("Expected a reversible step");
      }
      fixture.step({
        invocationId: `undo-${target}`,
        operation: "undo",
        targetStepId: target,
        actions: plan.writes.flatMap((batch) => batch.actions),
      });
    }
    expect(fixture.generation().origin.nodeOwners.node).toBe("workspace");
    expect(fixture.generation().origin.occurrences.occurrence?.parentNodeId).toBe("workspace");
    expect(projectionText(fixture.generation().origin, "node")).toBe("Shared later text");
  });

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

      const selection = queryHistory("channel", fixture.snapshot()).undo;
      expect(selection).not.toBeNull();
      expect(validateHistorySelection("undo", selection!, fixture.snapshot(), fixture.generation()).kind).toBe(
        "unavailable",
      );
    }
  });
});
