import { describe, expect, it } from "vitest";

import { mutationRelations, templateInstanceNodeId, type Mutation } from "./index.js";

describe("mutation relations", () => {
  it("captures template instance identities and the supertag sources they derive from", () => {
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
      sourceSupertagIds: ["source-supertag"],
      sourceApplicationSupertagIds: ["application-supertag"],
      sourceTemplateOccurrenceIds: ["source-template-occurrence"],
    };

    const relations = mutationRelations(mutation);

    expect(new Set(relations.nodeIds)).toEqual(
      new Set([
        "owner",
        "template",
        templateInstanceNodeId("owner", "template"),
        "source-supertag",
        "application-supertag",
      ]),
    );
    expect(new Set(relations.occurrenceIds)).toEqual(
      new Set(["instance-occurrence", "after", "before", "source-template-occurrence"]),
    );
    expect(new Set(relations.supertagIds)).toEqual(new Set(["source-supertag", "application-supertag"]));
    expect(relations.instanceSupertagIds).toEqual(["application-supertag"]);
  });

  it("captures initialized field identities and their causal observations", () => {
    const mutation: Mutation = {
      kind: "field-initialize",
      ownerNodeId: "owner",
      supertagId: "supertag",
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
      new Set(["owner", "supertag", "field-definition", "field-node", "text-node", "reference-node"]),
    );
    expect(new Set(relations.occurrenceIds)).toEqual(
      new Set(["field-occurrence", "text-occurrence", "reference-occurrence"]),
    );
    expect(relations.factIds).toEqual(["observed-fact"]);
    expect(relations.instanceSupertagIds).toEqual(["supertag"]);
    expect(relations.fieldDefinitionIds).toEqual(["field-definition"]);
  });

  it("keeps text atom contributions as typed relations", () => {
    const textRelations = mutationRelations({
      kind: "text-mark",
      nodeId: "text",
      atomIds: ["contribution-a#0", "contribution-b#3"],
      key: "bold",
      value: { kind: "set", value: true },
    });

    expect(textRelations.factIds).toEqual(["contribution-a", "contribution-b"]);
  });
});
