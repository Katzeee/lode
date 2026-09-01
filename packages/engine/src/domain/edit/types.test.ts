import { describe, expect, it } from "vitest";

import { expandEditAction } from "./types.js";
import { END_SEQUENCE_ANCHOR as end } from "../fact/index.js";

describe("Node creation edits", () => {
  it("expands one user operation only at the Fact boundary", () => {
    const edit = {
      kind: "node-create",
      nodeId: "child",
      occurrenceId: "child-original",
      parentNodeId: "parent",
      anchor: end,
    } as const;

    expect(expandEditAction(edit)).toEqual([
      {
        kind: "node-create",
        nodeId: "child",
        ownerNodeId: "parent",
        originalPlacement: { placementId: "child-original", anchor: end },
      },
    ]);
  });
});
