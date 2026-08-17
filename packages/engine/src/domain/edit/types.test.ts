import { describe, expect, it } from "vitest";

import { expandEditMutation } from "./types.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Node creation edits", () => {
  it("expands one user operation only at the Fact boundary", () => {
    const edit = {
      kind: "node-create",
      nodeId: "child",
      occurrenceId: "child-original",
      parentNodeId: "parent",
      anchor: end,
    } as const;

    expect(expandEditMutation(edit)).toEqual({
      kind: "atomic",
      mutations: [
        { kind: "node-create", nodeId: "child" },
        {
          kind: "node-owner-set",
          nodeId: "child",
          ownerNodeId: "parent",
          previousOwnerNodeId: null,
        },
        {
          kind: "occurrence-create",
          occurrenceId: "child-original",
          nodeId: "child",
          parentNodeId: "parent",
          anchor: end,
        },
      ],
    });
  });

  it("does not reinterpret an existing-Node reference as a Node creation", () => {
    const reference = {
      kind: "occurrence-create" as const,
      occurrenceId: "reference",
      nodeId: "existing",
      parentNodeId: "context",
      anchor: end,
    };

    expect(expandEditMutation(reference)).toEqual({ kind: "single", mutation: reference });
  });
});
