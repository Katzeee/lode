import { describe, expect, it } from "vitest";

import { factActionId, factActions } from "./fact-actions.js";
import { makeFact } from "./fact.js";
import { isFactActionId, requireFactActionId, requireFactId } from "./identities.js";
import { parseAuthoredAction } from "./shape-validation.js";
import { buildFactSnapshot } from "./snapshot.js";

describe("edit Facts", () => {
  it("keeps all actions in one authoritative Fact", () => {
    const fact = makeFact({
      workspaceId: "workspace",
      replicaId: "101",
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "edit",
        actorId: "actor",
        intent: "direct",
        actions: [
          { kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null },
          {
            kind: "placement-create",
            placementId: "node-original",
            nodeId: "node",
            parentNodeId: "workspace",
            anchor: { after: null, before: null, affinity: "after", fallback: "end" },
          },
        ],
      },
    });

    const snapshot = buildFactSnapshot("workspace", [fact]);
    expect(snapshot.facts).toEqual([fact]);
    expect(snapshot.frontier).toEqual({ "101": 1 });
    expect(factActions(fact).map((action) => action.id)).toEqual([`${fact.id}/actions/0`, `${fact.id}/actions/1`]);
  });

  it("keeps Fact and Fact Action identities disjoint at decoding boundaries", () => {
    const factId = "g1/workspace/101/1";
    const actionId = factActionId(factId, 0);

    expect(requireFactId(factId, "Fact")).toBe(factId);
    expect(() => requireFactId(actionId, "Fact")).toThrow("Fact must be a Fact identity");
    expect(isFactActionId(factId)).toBe(false);
    expect(isFactActionId(actionId)).toBe(true);
    expect(requireFactActionId(actionId, "Fact Action")).toBe(actionId);
    expect(
      parseAuthoredAction({
        kind: "placement-create",
        placementId: "occ",
        nodeId: "node",
        parentNodeId: "parent",
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      }),
    ).toEqual({
      kind: "placement-create",
      placementId: "occ",
      nodeId: "node",
      parentNodeId: "parent",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    });
  });
});
