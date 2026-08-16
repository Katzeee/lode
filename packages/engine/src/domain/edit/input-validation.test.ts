import { describe, expect, it } from "vitest";

import { parseEditMutation } from "./input-validation.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

describe("edit input validation", () => {
  it("accepts domain intent without prepared Fact evidence", () => {
    expect(
      parseEditMutation({
        kind: "occurrence-move",
        occurrenceId: "placement",
        parentNodeId: "parent",
        anchor: end,
      }),
    ).toEqual({
      kind: "occurrence-move",
      occurrenceId: "placement",
      parentNodeId: "parent",
      anchor: end,
    });
  });

  it("rejects causal evidence owned by Fact preparation", () => {
    expect(() =>
      parseEditMutation({
        kind: "occurrence-move",
        occurrenceId: "placement",
        parentNodeId: "parent",
        anchor: end,
        previousParentNodeId: "old-parent",
      }),
    ).toThrow(/Prepared Fact evidence/);
  });

  it("names ownership changes as Reference promotion", () => {
    expect(parseEditMutation({ kind: "reference-promote", occurrenceId: "reference" })).toEqual({
      kind: "reference-promote",
      occurrenceId: "reference",
    });
    expect(() =>
      parseEditMutation({
        kind: "node-owner-set",
        nodeId: "node",
        ownerNodeId: "parent",
      }),
    ).toThrow(/not a public edit operation/);
  });

  it("accepts an explicit Node type on Node creation", () => {
    expect(
      parseEditMutation({
        kind: "node-create",
        nodeId: "tag",
        occurrenceId: "tag-original",
        parentNodeId: "workspace",
        anchor: end,
        nodeType: "supertag-definition",
      }),
    ).toMatchObject({
      kind: "node-create",
      nodeId: "tag",
      nodeType: "supertag-definition",
    });
  });
});
