import { describe, expect, it } from "vitest";

import {
  END_SEQUENCE_ANCHOR as end,
  isNodeAction,
  isPlacementAction,
  isSupertagAction,
  isTextAction,
  type AuthoredAction,
} from "./index.js";

describe("AuthoredAction family", () => {
  it("classifies domain families without inferring them from naming conventions", () => {
    const actions = {
      node: { kind: "node-trash", nodeId: "node" },
      occurrence: { kind: "placement-remove", placementId: "occurrence" },
      supertag: {
        kind: "supertag-application-add",
        hostNodeId: "node",
        supertagId: "supertag",
        anchor: end,
      },
      text: {
        kind: "rich-text-mark",
        nodeId: "node",
        atomIds: [],
        key: "emphasis",
        value: { kind: "set", value: true },
      },
    } as const satisfies Readonly<Record<string, AuthoredAction>>;

    expect(isNodeAction(actions.node)).toBe(true);
    expect(isNodeAction(actions.occurrence)).toBe(false);
    expect(isPlacementAction(actions.occurrence)).toBe(true);
    expect(isPlacementAction(actions.supertag)).toBe(false);
    expect(isSupertagAction(actions.supertag)).toBe(true);
    expect(isSupertagAction(actions.text)).toBe(false);
    expect(isTextAction(actions.text)).toBe(true);
    expect(isTextAction(actions.node)).toBe(false);
  });
});
