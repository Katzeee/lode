import { describe, expect, it } from "vitest";

import { admitAuthorityRecordShapes, collectFactTransactions } from "../../../domain/fact/index.js";
import { createPlanningTransaction } from "./planning-fact.js";

describe("planning Facts", () => {
  it("uses the final write boundary for valid planning transaction identities", () => {
    const facts = createPlanningTransaction("workspace", { facts: [], frontier: {} }, "actor", "direct", [
      { kind: "node-create", nodeId: "workspace" },
      {
        kind: "occurrence-create",
        occurrenceId: "node",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      },
    ]);

    expect(
      admitAuthorityRecordShapes(
        "workspace",
        facts.map((fact) => ({ recordKind: "fact" as const, fact })),
      ),
    ).toMatchObject({ kind: "ready" });
    expect(new Set(facts.map((fact) => fact.transaction.transactionId)).size).toBe(1);
    expect(collectFactTransactions(facts)).toMatchObject({
      complete: [{ facts }],
      pendingTransactionIds: [],
    });
    expect(facts.map((fact) => fact.body.actorId)).toEqual(["actor", "actor"]);
  });
});
