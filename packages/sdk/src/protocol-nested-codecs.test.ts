import { describe, expect, it } from "vitest";

import { fromEffectiveField } from "./protocol-effective-field-codec.js";
import { fromFieldDefinitionConfiguration } from "./protocol-field-definition-configuration-codec.js";
import { fromProjectionPage } from "./protocol-projection-codec.js";
import { fromSearchExpressionSpec } from "./protocol-search-expression-codec.js";
import { fromInvocationOutcome } from "./protocol-shape-codec.js";
import { fromViewOptionsSpec } from "./protocol-view-options-codec.js";

describe("nested protocol decoding", () => {
  it("rejects unknown Search selectors and enum values", () => {
    expect(() => fromSearchExpressionSpec(searchExpression({ case: "future", value: {} }))).toThrow(
      "Search Expression clause has unsupported case future",
    );
    expect(() =>
      fromSearchExpressionSpec(
        searchExpression({
          case: "dateCompare",
          value: { fieldDefinitionId: "field", operator: 999, date: "2026-08-30" },
        }),
      ),
    ).toThrow("Search date comparison operator has unsupported value 999");
    expect(() =>
      fromSearchExpressionSpec(
        searchExpression({
          case: "fieldValue",
          value: { fieldDefinitionId: "field", value: { value: { case: "future", value: "x" } } },
        }),
      ),
    ).toThrow("Search Field value has unsupported case future");
    expect(() =>
      fromSearchExpressionSpec(
        searchExpression({
          case: "descendantOf",
          value: { target: { target: { case: "future", value: {} } } },
        }),
      ),
    ).toThrow("Search scope target has unsupported case future");
  });

  it("rejects an unknown Field Definition configuration selector", () => {
    expect(() =>
      fromFieldDefinitionConfiguration({
        configurationNodeId: "configuration",
        configurationOccurrenceId: "configuration-occurrence",
        factActionId: "g1/workspace/1/1/actions/0",
        definitionNodeId: "definition",
        configuration: { case: "future", value: {} },
      }),
    ).toThrow("Field Definition configuration has unsupported case future");
  });

  it("rejects unknown typed-value and Projected Node content selectors", () => {
    expect(() => fromProjectionPage(projectionPage("futureSection", { values: {} }))).toThrow(
      "Projection page section has unsupported value futureSection",
    );

    expect(() =>
      fromProjectionPage(
        projectionPage("typedFieldValues", {
          values: {
            field: {
              values: [
                {
                  ownerNodeId: "owner",
                  fieldDefinitionId: "field",
                  fieldNodeId: "field-node",
                  fieldOccurrenceId: "field-occurrence",
                  datatypeNodeId: "datatype",
                  valueOccurrenceIds: ["value-occurrence"],
                  state: "value",
                  semanticValue: { case: "future", value: {} },
                },
              ],
            },
          },
        }),
      ),
    ).toThrow("Typed Field semantic value has unsupported case future");

    expect(() =>
      fromProjectionPage(
        projectionPage("typedFieldValues", {
          values: {
            field: {
              values: [
                {
                  ownerNodeId: "owner",
                  fieldDefinitionId: "field",
                  fieldNodeId: "field-node",
                  fieldOccurrenceId: "field-occurrence",
                  datatypeNodeId: "datatype",
                  valueOccurrenceIds: [],
                  state: null,
                  semanticValue: null,
                },
              ],
            },
          },
        }),
      ),
    ).toThrow("Typed Field Value state is unspecified or unrecognized");

    expect(() =>
      fromProjectionPage(
        projectionPage("nodes", {
          values: {
            node: {
              nodeId: "node",
              intrinsicNodeType: null,
              content: [{ content: { case: "future", value: {} } }],
            },
          },
        }),
      ),
    ).toThrow("Projected Node content has unsupported case future");
  });

  it("rejects unknown Effective Field source and Static Default selectors", () => {
    expect(() =>
      fromEffectiveField({
        ...effectiveFieldBase(),
        sources: [{ source: { case: "future", value: {} } }],
        staticDefault: { candidates: [], state: { case: "none", value: true } },
      }),
    ).toThrow("Effective Field source has unsupported case future");
    expect(() =>
      fromEffectiveField({
        ...effectiveFieldBase(),
        sources: [],
        staticDefault: { candidates: [], state: { case: "future", value: true } },
      }),
    ).toThrow("Effective Static Default state has unsupported case future");
  });

  it("rejects an unknown View sort direction", () => {
    expect(() =>
      fromViewOptionsSpec({
        columns: [],
        filter: null,
        sort: {
          sortId: "g1/workspace/1/1/actions/0",
          sortNodeId: "sort",
          fieldDefinitionId: "field",
          direction: "sideways",
        },
        group: null,
      }),
    ).toThrow("View sort direction is invalid: sideways");
  });

  it("rejects an unknown Invocation outcome selector", () => {
    expect(() => fromInvocationOutcome({ result: { case: "future", value: {} } } as never)).toThrow(
      "Invocation outcome has unsupported case future",
    );
  });
});

function searchExpression(expression: Readonly<{ case: string; value: unknown }>): Record<string, unknown> {
  return {
    expressionId: "g1/workspace/1/1/actions/0",
    expressionNodeId: "expression",
    expression,
  };
}

function projectionPage(section: string, value: unknown): Record<string, unknown> {
  return {
    identity: {
      workspaceNodeId: "workspace",
      generationId: "generation",
      frontier: {},
      rulesVersion: "rules",
      schemaVersion: "schema",
    },
    perspective: "origin",
    next: null,
    content: { case: section, value },
  };
}

function effectiveFieldBase(): Record<string, unknown> {
  return {
    ownerNodeId: "owner",
    fieldDefinitionId: "field",
    visibility: "normal",
    materializedFieldNodeId: null,
    visibilityConflicted: false,
  };
}
