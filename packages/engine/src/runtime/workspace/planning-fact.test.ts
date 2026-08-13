import { describe, expect, it } from "vitest";

import { admitAuthorityRecordShapes } from "../../domain/fact/index.js";
import { createPlanningFact } from "./planning-fact.js";

describe("planning Facts", () => {
  it("uses a valid singleton transaction identity", () => {
    const fact = createPlanningFact("workspace", { facts: [], frontier: {} }, "direct", {
      kind: "node-create",
      nodeId: "workspace",
    });

    expect(admitAuthorityRecordShapes("workspace", [{ recordKind: "fact", fact }])).toMatchObject({
      kind: "ready",
    });
  });
});
