import { describe, expect, it } from "vitest";

import { FIELD_DATATYPE_CATALOG_NODE_ID, FIELD_DATATYPE_NODE_IDS, workspaceTrashNodeId } from "../fact/index.js";
import { rebuildGeneration } from "./index.js";
import { projectSnapshot, projectionText } from "../../../tests/support/reconcile/projection.js";
import { fullSurface } from "../../../tests/support/reconcile/full-surface-test-fixture.js";
import { base, end, Facts, versions } from "../../../tests/support/reconcile/reconcile-test-helpers.js";

describe("production Reconcile", () => {
  it("PROJ-1 projection is deterministic for one snapshot and versions", () => {
    const facts = base();
    facts.add({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "abc",
    });
    const snapshot = facts.snapshot();
    const shuffled = { ...snapshot, facts: [...snapshot.facts].reverse() };

    expect(projectSnapshot("workspace", shuffled, "origin", versions)).toEqual(
      projectSnapshot("workspace", snapshot, "origin", versions),
    );
  });

  it("PROJ-2 origin and review share activation and support rules", () => {
    const facts = base();
    const proposal = facts.add(
      {
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "proposal",
      },
      "proposal",
    );
    let snapshot = facts.snapshot();
    expect(projectionText(projectSnapshot("workspace", snapshot, "origin", versions), "node")).toBe("");
    expect(projectionText(projectSnapshot("workspace", snapshot, "review", versions), "node")).toBe("proposal");

    facts.resolve([proposal.id], "accept");
    snapshot = facts.snapshot();
    const accepted = rebuildGeneration("workspace", snapshot, versions);
    expect(projectionText(accepted.origin, "node")).toBe("proposal");
    expect(accepted.origin.nodes).toEqual(accepted.review.nodes);
  });

  it("MODEL-1 direct and proposal share the complete action vocabulary", () => {
    const direct = fullSurface("direct");
    const proposal = fullSurface("proposal");
    const directProjection = projectSnapshot("workspace", direct.snapshot(), "origin", versions);
    const proposalProjection = projectSnapshot("workspace", proposal.snapshot(), "review", versions);

    expect(proposalProjection.nodes).toEqual(directProjection.nodes);
    expect(proposalProjection.occurrences).toEqual(directProjection.occurrences);
    expect(proposalProjection.nodeOwners).toEqual(directProjection.nodeOwners);
  });

  it("MODEL-2 node and occurrence ownership preserves transclusion", () => {
    const facts = base();
    facts.add({ kind: "node-create", nodeId: "reference-parent", ownerNodeId: "workspace", originalPlacement: null });
    facts.add({
      kind: "rich-text-splice",
      nodeId: "node",
      deleteAtomIds: [],
      anchor: end,
      insert: "shared",
    });
    facts.add({
      kind: "placement-create",
      placementId: "reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projectionText(projection, "node")).toBe("shared");
    expect(Object.values(projection.occurrences).filter((value) => value.nodeId === "node")).toHaveLength(2);
    expect(projection.occurrences.occurrence?.parentNodeId).toBe("workspace");
    expect(projection.occurrences.reference?.parentNodeId).toBe("reference-parent");
  });

  it("MODEL-3 stored structure stays valid across projection cycles", () => {
    const facts = base();
    facts.add({
      kind: "placement-create",
      placementId: "self-reference",
      nodeId: "node",
      parentNodeId: "node",
      anchor: end,
    });
    facts.add({
      kind: "placement-move",
      placementId: "occurrence",
      parentNodeId: "node",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);

    expect(projection.occurrences.occurrence?.parentNodeId).toBe("workspace");
    expect(projection.occurrences["self-reference"]?.parentNodeId).toBe("node");
  });

  it("MODEL-4 restore causally clears every observed deletion", () => {
    const facts = base();
    facts.add({ kind: "node-trash", nodeId: "node" });
    expect(projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodeOwners.node).toBe(
      workspaceTrashNodeId("workspace"),
    );

    facts.add({
      kind: "node-restore",
      nodeId: "node",
      placementId: "occurrence",
      parentNodeId: "workspace",
      anchor: end,
    });
    expect(projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodes.node).toBeDefined();
    facts.add({ kind: "node-trash", nodeId: "node" });
    expect(projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodeOwners.node).toBe(
      workspaceTrashNodeId("workspace"),
    );

    const occurrenceFacts = base();
    occurrenceFacts.add({
      kind: "placement-remove",
      placementId: "occurrence",
    });
    occurrenceFacts.add({
      kind: "placement-remove",
      placementId: "occurrence",
    });
    occurrenceFacts.add({
      kind: "placement-create",
      placementId: "occurrence",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    });
    occurrenceFacts.add({
      kind: "placement-create",
      placementId: "occurrence",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    });
    expect(
      projectSnapshot("workspace", occurrenceFacts.snapshot(), "origin", versions).occurrences.occurrence,
    ).toBeDefined();
  });

  it("derives the Workspace Trash target from its canonical role Occurrence", () => {
    const facts = new Facts("custom-trash-node");
    facts.addPlaced("node");
    facts.add({ kind: "node-trash", nodeId: "node" });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.workspaceSystemNodes).toEqual({
      trash: "custom-trash-node",
      schema: "workspace-schema:v1:workspace",
      systemDefinitionCatalog: "system-definition-catalog:v1",
    });
    expect(projection.nodeOwners.node).toBe("custom-trash-node");
    expect(projection.nodes["custom-trash-node"]).toBeDefined();
  });

  it("keeps hidden System Definition ownership when a relation references its Node", () => {
    const facts = new Facts();
    facts.addPlaced("relation");
    facts.add({
      kind: "placement-create",
      placementId: "datatype-reference",
      nodeId: FIELD_DATATYPE_NODE_IDS.plain,
      parentNodeId: "relation",
      anchor: end,
    });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodeOwners[FIELD_DATATYPE_NODE_IDS.plain]).toBe(FIELD_DATATYPE_CATALOG_NODE_ID);
    expect(projection.occurrences["datatype-reference"]).toMatchObject({
      nodeId: FIELD_DATATYPE_NODE_IDS.plain,
      parentNodeId: "relation",
    });
  });
});
