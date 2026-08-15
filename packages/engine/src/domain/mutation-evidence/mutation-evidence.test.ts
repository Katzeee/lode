import { describe, expect, it } from "vitest";

import { rebuildGeneration } from "../reconcile/index.js";
import { end, Facts, versions } from "../../../tests/support/reconcile/reconcile-test-helpers.js";
import { completeMutationEvidence } from "./policy.js";

describe("Mutation evidence", () => {
  it("derives Direct Value evidence from Origin while Review contains a Proposal", () => {
    const facts = new Facts();
    facts.addPlaced("node");
    facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "color",
        value: "blue",
        previous: { kind: "unset" },
      },
      "proposal",
    );
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;

    const completed = completeMutationEvidence(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "color",
        value: "red",
      },
      {
        snapshot: facts.snapshot(),
        projections: () => ({ previous: generation.origin, available: generation.review }),
      },
    );

    expect(generation.review.nodes.node?.properties.color).toBe("blue");
    expect(completed).toMatchObject({ previous: { kind: "unset" } });
  });

  it("compares Text mark states by canonical value", () => {
    const facts = new Facts();
    facts.addPlaced("node");
    facts.add({
      kind: "text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "AB",
      attributes: { style: { weight: 700 } },
    });
    const projection = rebuildGeneration("workspace", facts.snapshot(), versions).generation.review;
    const node = projection.nodes.node;
    if (!node) {
      throw new Error("Expected text Node");
    }
    const observed = {
      ...projection,
      nodes: {
        ...projection.nodes,
        node: {
          ...node,
          text: node.text.map((atom) => ({
            ...atom,
            attributes: { style: { weight: 700 } },
          })),
        },
      },
    };
    const atomIds = observed.nodes.node.text.map((atom) => atom.id);

    const completed = completeMutationEvidence(
      {
        kind: "text-mark",
        nodeId: "node",
        atomIds,
        key: "style",
        value: { kind: "unset" },
      },
      {
        snapshot: facts.snapshot(),
        projections: () => ({ previous: observed, available: observed }),
      },
    );

    expect(completed).toMatchObject({ previous: { kind: "set", value: { weight: 700 } } });
  });

  it("derives one stable previous Occurrence placement", () => {
    const facts = new Facts();
    facts.addPlaced("node");
    const projection = rebuildGeneration("workspace", facts.snapshot(), versions).generation.review;

    const completed = completeMutationEvidence(
      { kind: "occurrence-delete", occurrenceId: "node-original" },
      {
        snapshot: facts.snapshot(),
        projections: () => ({ previous: projection, available: projection }),
      },
    );

    expect(completed).toMatchObject({
      previousParentNodeId: "workspace",
      previousAnchor: { after: null, before: null, fallback: "start" },
    });
  });

  it("derives Direct Schema removal evidence from Origin ordering", () => {
    const facts = new Facts();
    facts.addPlaced("schema-a");
    facts.addPlaced("schema-b");
    facts.addPlaced("target");
    facts.add({ kind: "node-type-declare", nodeId: "schema-a", nodeType: "schema" });
    facts.add({ kind: "node-type-declare", nodeId: "schema-b", nodeType: "schema" });
    facts.add({ kind: "schema-apply", nodeId: "target", schemaId: "schema-a", anchor: end });
    facts.add(
      {
        kind: "schema-apply",
        nodeId: "target",
        schemaId: "schema-b",
        anchor: {
          after: null,
          before: "schema-a",
          affinity: "before",
          fallback: "start",
        },
      },
      "proposal",
    );
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;

    const completed = completeMutationEvidence(
      { kind: "schema-remove", nodeId: "target", schemaId: "schema-a" },
      {
        snapshot: facts.snapshot(),
        projections: () => ({ previous: generation.origin, available: generation.review }),
      },
    );

    expect(generation.review.schemaApplications.target).toEqual(["schema-b", "schema-a"]);
    expect(completed).toMatchObject({
      previousAnchor: {
        after: null,
        before: null,
        affinity: "before",
        fallback: "start",
      },
    });
  });
});
