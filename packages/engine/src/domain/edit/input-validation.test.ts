import { describe, expect, it } from "vitest";

import { parseEditAction } from "./input-validation.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const semanticId = "g1/workspace/101/2/actions/0";

describe("edit input validation", () => {
  it("accepts domain intent without prepared Fact evidence", () => {
    expect(
      parseEditAction({
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

  it("accepts Reference promotion", () => {
    expect(parseEditAction({ kind: "reference-promote", occurrenceId: "reference" })).toEqual({
      kind: "reference-promote",
      occurrenceId: "reference",
    });
  });

  it("accepts an explicit Intrinsic Node Type on Node creation", () => {
    expect(
      parseEditAction({
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
      parseEditAction({
        kind: "supertag-template-field-static-default-set",
        supertagId: "task-supertag",
        templateFieldId: semanticId,
        value: "",
      }),
    ).toEqual({
      kind: "supertag-template-field-static-default-set",
      supertagId: "task-supertag",
      templateFieldId: semanticId,
      value: "",
    });
    expect(() =>
      parseEditAction({
        kind: "supertag-template-field-static-default-set",
        supertagId: "task-supertag",
        templateFieldId: semanticId,
        value: null,
      }),
    ).toThrow("Template Field Static Default is invalid");
  });

  it("validates recursive Search Expression intent without caller-owned projection identities", () => {
    expect(
      parseEditAction({
        kind: "search-expression-create",
        searchNodeId: "search",
        anchor: end,
        expression: {
          kind: "and",
          operands: [
            { kind: "supertag", supertagId: "task" },
            {
              kind: "not",
              operand: { kind: "text", text: "archived" },
            },
          ],
        },
      }),
    ).toMatchObject({ kind: "search-expression-create", expression: { kind: "and" } });
    expect(() =>
      parseEditAction({
        kind: "search-expression-create",
        searchNodeId: "search",
        anchor: end,
        expression: { kind: "not", operand: { kind: "unknown" } },
      }),
    ).toThrow();
  });

  it("validates semantic View option edits and their Fact identities", () => {
    expect(
      parseEditAction({
        kind: "view-sort-add",
        hostNodeId: "host",
        viewId: semanticId,
        fieldDefinitionId: "date",
        direction: "descending",
      }),
    ).toEqual({
      kind: "view-sort-add",
      hostNodeId: "host",
      viewId: semanticId,
      fieldDefinitionId: "date",
      direction: "descending",
    });
    expect(() =>
      parseEditAction({
        kind: "view-sort-add",
        hostNodeId: "host",
        viewId: "view",
        fieldDefinitionId: "date",
        direction: "ascending",
      }),
    ).toThrow("View identity must be a Fact Action identity");

    expect(
      parseEditAction({
        kind: "view-filter-expression-configure",
        hostNodeId: "host",
        viewId: semanticId,
        filterId: "g1/workspace/101/2/actions/1",
        expressionId: "g1/workspace/101/2/actions/2",
        clause: { kind: "text", text: "ready" },
      }),
    ).toMatchObject({ kind: "view-filter-expression-configure", clause: { kind: "text", text: "ready" } });
  });
});
