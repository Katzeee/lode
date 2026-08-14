import { describe, expect, it } from "vitest";

import { FIELD_NODE_TYPE, SEARCH_NODE_TYPE } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";
import { resolveNodePresentation } from "./node-presentation.js";

type Source = Pick<
  Projection,
  "nodes" | "occurrences" | "nodeOwners" | "nodeStatuses" | "templateFields" | "materializedFields"
>;

describe("Node presentation", () => {
  it("composes a Reference appearance and durable Node type without inventing content types", () => {
    const source = presentationSource();

    expect(resolveNodePresentation(source, "search-reference")).toEqual({
      nodeId: "search",
      occurrenceId: "search-reference",
      occurrence: { kind: "reference" },
      nodeType: SEARCH_NODE_TYPE,
      content: { kind: "text", text: "https://example.com/oracle" },
      fieldOccurrence: null,
    });
  });

  it("combines the Field Node type with its Definition binding", () => {
    const source = presentationSource();

    expect(resolveNodePresentation(source, "field-occurrence")).toMatchObject({
      nodeId: "field-node",
      nodeType: FIELD_NODE_TYPE,
      occurrence: { kind: "original" },
      fieldOccurrence: { ownerNodeId: "owner", fieldDefinitionId: "field-definition" },
    });
    expect(resolveNodePresentation(source, "template-field-occurrence")).toMatchObject({
      nodeId: "template-field-node",
      nodeType: FIELD_NODE_TYPE,
      occurrence: { kind: "original" },
      fieldOccurrence: { ownerNodeId: "schema", fieldDefinitionId: "field-definition" },
    });
  });
});

function presentationSource(): Source {
  return {
    nodes: {
      search: node("search", "https://example.com/oracle"),
      "field-node": node("field-node", ""),
      "template-field-node": node("template-field-node", ""),
    },
    occurrences: {
      "search-original": occurrence("search-original", "search", "home"),
      "search-reference": occurrence("search-reference", "search", "elsewhere"),
      "field-occurrence": occurrence("field-occurrence", "field-node", "owner"),
      "template-field-occurrence": occurrence(
        "template-field-occurrence",
        "template-field-node",
        "schema",
      ),
    },
    nodeOwners: { search: "home", "field-node": "owner", "template-field-node": "schema" },
    nodeStatuses: {
      search: {
        nodeId: "search",
        nodeType: SEARCH_NODE_TYPE,
        state: "active",
        deletionFactIds: [],
      },
      "field-node": {
        nodeId: "field-node",
        nodeType: FIELD_NODE_TYPE,
        state: "active",
        deletionFactIds: [],
      },
      "template-field-node": {
        nodeId: "template-field-node",
        nodeType: FIELD_NODE_TYPE,
        state: "active",
        deletionFactIds: [],
      },
    },
    templateFields: {
      schema: [
        {
          schemaId: "schema",
          fieldDefinitionId: "field-definition",
          fieldNodeId: "template-field-node",
          fieldOccurrenceId: "template-field-occurrence",
          configCandidates: [],
          effectiveConfig: null,
        },
      ],
    },
    materializedFields: {
      owner: [
        {
          ownerNodeId: "owner",
          fieldDefinitionId: "field-definition",
          fieldNodeId: "field-node",
          fieldOccurrenceId: "field-occurrence",
          valueOccurrenceIds: [],
        },
      ],
    },
  };
}

function node(nodeId: string, text: string): Projection["nodes"][string] {
  return {
    nodeId,
    text: [...text].map((value, index) => ({
      id: `fact#${index}`,
      value,
      attributes: {},
      contributionId: "fact",
    })),
    properties: {},
    metadata: {},
  };
}

function occurrence(
  occurrenceId: string,
  nodeId: string,
  parentNodeId: string,
): Projection["occurrences"][string] {
  return { occurrenceId, nodeId, parentNodeId, properties: {}, metadata: {}, derived: false };
}
