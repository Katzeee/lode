import { describe, expect, it } from "vitest";

import { workspaceTrashNodeId } from "../fact/index.js";
import { rebuildGeneration } from "../reconcile/index.js";
import { end, Facts, versions } from "../../../tests/support/reconcile/reconcile-test-helpers.js";
import { completeMutationEvidence } from "./policy.js";

describe("Mutation evidence", () => {
  it("protects the Workspace Trash role target rather than a deterministic Node identity", () => {
    const facts = new Facts("custom-trash-node");
    facts.addPlaced(workspaceTrashNodeId("workspace"));
    const projection = rebuildGeneration("workspace", facts.snapshot(), versions).generation.review;
    const context = {
      snapshot: facts.snapshot(),
      projections: () => ({ previous: projection, available: projection }),
    };

    expect(() => completeMutationEvidence({ kind: "node-delete", nodeId: "custom-trash-node" }, context)).toThrow(
      "Workspace Trash cannot be deleted",
    );
    expect(
      completeMutationEvidence({ kind: "node-delete", nodeId: workspaceTrashNodeId("workspace") }, context),
    ).toEqual({ kind: "node-delete", nodeId: workspaceTrashNodeId("workspace") });
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
          content: node.content.map((atom) => ({
            ...atom,
            attributes: { style: { weight: 700 } },
          })),
        },
      },
    };
    const atomIds = observed.nodes.node.content.filter((item) => item.kind === "text").map((atom) => atom.id);

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
      previousAnchor: {
        after: "workspace-trash-occ:v1:workspace",
        before: null,
        fallback: "end",
      },
    });
  });

  it("derives Direct Supertag removal evidence from Origin ordering", () => {
    const facts = new Facts();
    facts.addPlaced("supertag-a");
    facts.addPlaced("supertag-b");
    facts.addPlaced("target");
    facts.add({ kind: "node-type-declare", nodeId: "supertag-a", nodeType: "supertag-definition" });
    facts.add({ kind: "node-type-declare", nodeId: "supertag-b", nodeType: "supertag-definition" });
    facts.add({ kind: "supertag-apply", nodeId: "target", supertagId: "supertag-a", anchor: end });
    facts.add(
      {
        kind: "supertag-apply",
        nodeId: "target",
        supertagId: "supertag-b",
        anchor: {
          after: null,
          before: "supertag-a",
          affinity: "before",
          fallback: "start",
        },
      },
      "proposal",
    );
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions).generation;

    const completed = completeMutationEvidence(
      { kind: "supertag-remove", nodeId: "target", supertagId: "supertag-a" },
      {
        snapshot: facts.snapshot(),
        projections: () => ({ previous: generation.origin, available: generation.review }),
      },
    );

    expect(generation.review.supertagApplications.target).toEqual(["supertag-b", "supertag-a"]);
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
