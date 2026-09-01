import { describe, expect, it } from "vitest";

import { workspaceTrashNodeId } from "../fact/index.js";
import { rebuildGeneration } from "../reconcile/index.js";
import { Facts, versions } from "../../../tests/support/reconcile/reconcile-test-helpers.js";
import { addDefinitionNode } from "../../../tests/support/reconcile/placed-node-test-helpers.js";
import { assertAuthoredIntent } from "./policy.js";

describe("Authored Intent validation", () => {
  it("protects the Workspace Trash role target rather than a deterministic Node identity", () => {
    const facts = new Facts("custom-trash-node");
    facts.addPlaced(workspaceTrashNodeId("workspace"));
    const projection = rebuildGeneration("workspace", facts.snapshot(), versions).review;
    const context = {
      previous: projection,
      available: projection,
      resulting: projection,
    };

    expect(() => assertAuthoredIntent({ kind: "node-trash", nodeId: "custom-trash-node" }, context)).toThrow(
      "Workspace System Node cannot be deleted",
    );
    expect(() =>
      assertAuthoredIntent({ kind: "node-trash", nodeId: workspaceTrashNodeId("workspace") }, context),
    ).not.toThrow();
  });

  it("accepts deletion of an observed mutable Occurrence", () => {
    const facts = new Facts();
    facts.addPlaced("node");
    const projection = rebuildGeneration("workspace", facts.snapshot(), versions).review;

    expect(() =>
      assertAuthoredIntent(
        { kind: "placement-remove", placementId: "node-original" },
        { previous: projection, available: projection, resulting: projection },
      ),
    ).not.toThrow();
  });

  it("validates a Direct Supertag removal against Origin while Review ordering differs", () => {
    const facts = new Facts();
    addDefinitionNode(facts, "supertag-a", "supertag-definition");
    addDefinitionNode(facts, "supertag-b", "supertag-definition");
    facts.addPlaced("target");
    facts.applySupertag("target", "supertag-a");
    facts.applySupertag("target", "supertag-b", "proposal", {
      after: null,
      before: "supertag-a",
      affinity: "before",
      fallback: "start",
    });
    const generation = rebuildGeneration("workspace", facts.snapshot(), versions);

    expect(generation.review.supertagApplications.target?.map(({ supertagId }) => supertagId)).toEqual([
      "supertag-b",
      "supertag-a",
    ]);
    expect(() =>
      assertAuthoredIntent(
        {
          kind: "supertag-membership-remove",
          hostNodeId: "target",
          supertagId: "supertag-a",
        },
        {
          previous: generation.origin,
          available: generation.review,
          resulting: generation.review,
        },
      ),
    ).not.toThrow();
  });
});
