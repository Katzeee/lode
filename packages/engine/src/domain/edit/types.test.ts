import { describe, expect, it } from "vitest";

import { createNodeAt, expandEditMutation } from "./types.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("Node creation edits", () => {
  it("express one user operation and expand only at the Fact boundary", () => {
    const edit = createNodeAt({
      nodeId: "child",
      occurrenceId: "child-original",
      parentNodeId: "parent",
      anchor: end,
    });

    expect(edit).toEqual({
      kind: "node-create",
      nodeId: "child",
      occurrenceId: "child-original",
      parentNodeId: "parent",
      anchor: end,
    });
    expect(expandEditMutation(edit)).toEqual({
      kind: "atomic",
      mutations: [
        { kind: "node-create", nodeId: "child" },
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
