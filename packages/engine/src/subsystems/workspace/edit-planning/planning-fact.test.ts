import { describe, expect, it } from "vitest";

import { buildFactSnapshot } from "../../../domain/fact/index.js";
import { uniqueFacts } from "../../../../tests/support/facts.js";
import { createPlanningFact } from "./planning-fact.js";

describe("planning Facts", () => {
  it("uses the final write boundary with the authority identity assigned to the Edit", () => {
    const fact = createPlanningFact("workspace", "101", 1, {}, 1, "actor", "direct", [
      { kind: "node-create", nodeId: "workspace", ownerNodeId: "workspace", originalPlacement: null },
      {
        kind: "placement-create",
        placementId: "node",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      },
    ]);

    expect(buildFactSnapshot("workspace", uniqueFacts([fact])).facts).toEqual([fact]);
    expect(fact.body).toMatchObject({ kind: "action", actorId: "actor" });
    expect(fact.body.kind === "action" ? fact.body.actions : []).toHaveLength(2);
  });
});
