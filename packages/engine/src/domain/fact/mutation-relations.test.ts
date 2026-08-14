import { describe, expect, it } from "vitest";

import { mutationRelations, templateInstanceNodeId, type Mutation } from "./index.js";

describe("mutation relations", () => {
  it("captures template instance identities and the schema sources they derive from", () => {
    const mutation: Mutation = {
      kind: "template-node-detach",
      ownerNodeId: "owner",
      templateNodeId: "template",
      instanceNodeId: templateInstanceNodeId("owner", "template"),
      instanceOccurrenceId: "instance-occurrence",
      anchor: {
        after: "after",
        before: "before",
        affinity: "after",
        fallback: "end",
      },
      sourceSchemaIds: ["source-schema"],
      sourceApplicationSchemaIds: ["application-schema"],
      sourceTemplateOccurrenceIds: ["source-template-occurrence"],
    };

    const relations = mutationRelations(mutation);

    expect(new Set(relations.nodeIds)).toEqual(
      new Set([
        "owner",
        "template",
        templateInstanceNodeId("owner", "template"),
        "source-schema",
        "application-schema",
      ]),
    );
    expect(new Set(relations.occurrenceIds)).toEqual(
      new Set(["instance-occurrence", "after", "before", "source-template-occurrence"]),
    );
    expect(new Set(relations.schemaIds)).toEqual(new Set(["source-schema", "application-schema"]));
    expect(relations.instanceSchemaIds).toEqual(["application-schema"]);
  });

  it("captures initialized field identities and their causal observations", () => {
    const mutation: Mutation = {
      kind: "field-initialize",
      ownerNodeId: "owner",
      schemaId: "schema",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "field-node",
      fieldOccurrenceId: "field-occurrence",
      source: "static-default",
      values: [
        { kind: "text", nodeId: "text-node", occurrenceId: "text-occurrence", value: "x" },
        { kind: "reference", nodeId: "reference-node", occurrenceId: "reference-occurrence" },
      ],
      observedInitializationFactIds: ["observed-fact"],
    };

    const relations = mutationRelations(mutation);

    expect(new Set(relations.nodeIds)).toEqual(
      new Set(["owner", "schema", "field-definition", "field-node", "text-node", "reference-node"]),
    );
    expect(new Set(relations.occurrenceIds)).toEqual(
      new Set(["field-occurrence", "text-occurrence", "reference-occurrence"]),
    );
    expect(relations.factIds).toEqual(["observed-fact"]);
    expect(relations.instanceSchemaIds).toEqual(["schema"]);
    expect(relations.fieldDefinitionIds).toEqual(["field-definition"]);
  });

  it("keeps value addresses and text atom contributions as typed relations", () => {
    const valueRelations = mutationRelations({
      kind: "value-set",
      target: { kind: "occurrence", id: "occurrence" },
      namespace: "metadata",
      key: "key",
      value: true,
    });
    const textRelations = mutationRelations({
      kind: "text-mark",
      nodeId: "text",
      atomIds: ["contribution-a#0", "contribution-b#3"],
      key: "bold",
      value: { kind: "set", value: true },
    });

    expect(valueRelations.values).toEqual([
      { target: { kind: "occurrence", id: "occurrence" }, namespace: "metadata" },
    ]);
    expect(valueRelations.occurrenceIds).toContain("occurrence");
    expect(textRelations.factIds).toEqual(["contribution-a", "contribution-b"]);
  });
});
