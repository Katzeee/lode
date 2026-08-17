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

  it("accepts an explicit Intrinsic Node Type on Node creation", () => {
    expect(
      parseEditMutation({
        kind: "node-create",
        nodeId: "tag",
        occurrenceId: "tag-original",
        parentNodeId: "workspace",
        anchor: end,
        intrinsicNodeType: "supertag-definition",
      }),
    ).toMatchObject({
      kind: "node-create",
      nodeId: "tag",
      intrinsicNodeType: "supertag-definition",
    });
  });

  it("accepts an empty Static Default as an explicit clear and rejects non-text values", () => {
    expect(
      parseEditMutation({
        kind: "supertag-template-field-static-default-set",
        supertagId: "task-supertag",
        templateFieldNodeId: "status-template",
        value: "",
      }),
    ).toEqual({
      kind: "supertag-template-field-static-default-set",
      supertagId: "task-supertag",
      templateFieldNodeId: "status-template",
      value: "",
    });
    expect(() =>
      parseEditMutation({
        kind: "supertag-template-field-static-default-set",
        supertagId: "task-supertag",
        templateFieldNodeId: "status-template",
        value: null,
      }),
    ).toThrow("Template Field Static Default is invalid");
  });

  it("validates recursive Search Expressions and rejects duplicate clause identities", () => {
    expect(
      parseEditMutation({
        kind: "search-expression-update",
        searchNodeId: "search",
        expression: {
          expressionNodeId: "root",
          kind: "and",
          operands: [
            { expressionNodeId: "tag", kind: "supertag", supertagId: "task" },
            {
              expressionNodeId: "negated",
              kind: "not",
              operand: { expressionNodeId: "text", kind: "text", text: "archived" },
            },
          ],
        },
      }),
    ).toMatchObject({ kind: "search-expression-update", expression: { kind: "and" } });
    expect(() =>
      parseEditMutation({
        kind: "search-expression-update",
        searchNodeId: "search",
        expression: {
          expressionNodeId: "root",
          kind: "or",
          operands: [
            { expressionNodeId: "same", kind: "text", text: "one" },
            { expressionNodeId: "same", kind: "text", text: "two" },
          ],
        },
      }),
    ).toThrow(/repeats a Node identity/);
  });

  it("validates typed View options and rejects identities reused across rules", () => {
    expect(
      parseEditMutation({
        kind: "shared-default-view-definition-options-update",
        hostNodeId: "host",
        viewDefinitionNodeId: "view",
        options: {
          columns: [{ columnNodeId: "column", fieldDefinitionId: "status" }],
          filter: {
            filterNodeId: "filter",
            expression: {
              expressionNodeId: "predicate",
              kind: "field-defined",
              fieldDefinitionId: "status",
              defined: true,
            },
          },
          sort: { sortNodeId: "sort", fieldDefinitionId: "date", direction: "descending" },
          group: { groupNodeId: "group", fieldDefinitionId: "status" },
        },
      }),
    ).toMatchObject({ kind: "shared-default-view-definition-options-update" });
    expect(() =>
      parseEditMutation({
        kind: "shared-default-view-definition-options-update",
        hostNodeId: "host",
        viewDefinitionNodeId: "view",
        options: {
          columns: [{ columnNodeId: "same", fieldDefinitionId: "status" }],
          filter: null,
          sort: { sortNodeId: "same", fieldDefinitionId: "date", direction: "ascending" },
          group: null,
        },
      }),
    ).toThrow(/identities must be unique/);
  });
});
