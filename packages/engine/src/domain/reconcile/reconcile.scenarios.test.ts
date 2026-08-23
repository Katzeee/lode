import { describe, expect, it } from "vitest";

import { workspaceTrashNodeId, type FactActionId } from "../fact/index.js";
import { queryReview } from "../review/index.js";
import { metanodeNodeId, nodeLocation, rebuildGeneration } from "./index.js";
import { projectSnapshot, projectionText } from "../../../tests/support/reconcile/projection.js";
import { renderSemanticTree } from "../../../tests/support/reconcile/semantic-tree.js";
import { proposalLifecycleCases } from "../../../tests/support/reconcile/proposal-lifecycle-test-helpers.js";
import { fullSurface } from "../../../tests/support/reconcile/full-surface-test-fixture.js";
import { base, end, Facts, versions } from "../../../tests/support/reconcile/reconcile-test-helpers.js";
import { addPlacedNode } from "../../../tests/support/reconcile/placed-node-test-helpers.js";

describe("production Reconcile scenarios", () => {
  it("projects the Workspace as the root Node and gives every other Node one explicit owner", () => {
    const rootFacts = new Facts();
    const root = projectSnapshot("workspace", rootFacts.snapshot(), "origin", versions);
    expect(root.identity.workspaceNodeId).toBe("workspace");
    expect(root.nodes.workspace).toEqual({
      nodeId: "workspace",
      intrinsicNodeType: "workspace",
      content: [],
    });
    expect(root.nodeOwners.workspace).toBeNull();

    const unattachedFacts = new Facts();
    unattachedFacts.add({ kind: "node-create", nodeId: "node", ownerNodeId: "workspace", originalPlacement: null });
    const unattached = projectSnapshot("workspace", unattachedFacts.snapshot(), "origin", versions);
    expect(unattached.nodes.node).toBeDefined();
    expect(unattached.nodeOwners.node).toBe("workspace");

    const placed = projectSnapshot("workspace", base().snapshot(), "origin", versions);
    expect(placed.nodeOwners.node).toBe("workspace");
  });

  it("derives one Metanode without creating a visible Outline Occurrence", () => {
    const facts = base();
    addPlacedNode(facts, "tag", "direct", "workspace", "tag-original", "supertag-definition");
    facts.applySupertag("node", "tag");
    const metanodeId = metanodeNodeId("node");

    const active = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(active.metanodes).toEqual({ node: metanodeId });
    expect(active.nodeOwners[metanodeId]).toBe("node");
    expect(Object.values(active.occurrences).some((occurrence) => occurrence.nodeId === metanodeId)).toBe(false);
    expect(active.childOccurrences.node ?? []).not.toContain(metanodeId);

    facts.add({ kind: "node-trash", nodeId: "node" });
    const deleted = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(nodeLocation("workspace", deleted, metanodeId)).toBe("trash");
  });

  it("keeps Owner authority independent from a non-owning Reference edge", () => {
    const facts = base();
    addPlacedNode(facts, "parent");
    facts.add({
      kind: "placement-create",
      placementId: "node-reference",
      nodeId: "node",
      parentNodeId: "parent",
      anchor: end,
    });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodeOwners.node).toBe("workspace");
    expect(projection.occurrences["node-reference"]?.parentNodeId).toBe("parent");
  });

  it("moves Owner authority with the selected Original Placement", () => {
    const facts = base();
    addPlacedNode(facts, "parent");
    facts.add({ kind: "placement-move", placementId: "occurrence", parentNodeId: "parent", anchor: end });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.occurrences.occurrence?.parentNodeId).toBe("parent");
    expect(projection.nodeOwners.node).toBe("parent");
  });

  it("falls back between complete Placement creation intents without mixing their Node and position", () => {
    const facts = new Facts();
    facts.add({
      kind: "node-create",
      nodeId: "node-a",
      ownerNodeId: "workspace",
      originalPlacement: { placementId: "shared-placement", anchor: end },
    });
    facts.add({ kind: "node-create", nodeId: "node-b", ownerNodeId: "workspace", originalPlacement: null });
    facts.add({
      kind: "placement-create",
      placementId: "node-b-reference",
      nodeId: "node-b",
      parentNodeId: "workspace",
      anchor: end,
    });
    facts.add({
      kind: "node-create",
      nodeId: "node-b",
      ownerNodeId: "workspace",
      originalPlacement: { placementId: "shared-placement", anchor: end },
    });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.occurrences["shared-placement"]).toMatchObject({
      nodeId: "node-a",
      parentNodeId: "workspace",
    });
    expect(projection.occurrences["node-b-reference"]).toMatchObject({
      nodeId: "node-b",
      parentNodeId: "workspace",
    });
  });

  it("orders a Placement by the valid fallback intent rather than a rejected newer candidate", () => {
    const facts = new Facts();
    facts.add({
      kind: "node-create",
      nodeId: "node-a",
      ownerNodeId: "workspace",
      originalPlacement: { placementId: "placement-a", anchor: end },
    });
    facts.add({
      kind: "node-create",
      nodeId: "anchored",
      ownerNodeId: "workspace",
      originalPlacement: {
        placementId: "anchored-placement",
        anchor: { after: "placement-a", before: null, affinity: "after", fallback: "end" },
      },
    });
    facts.add({ kind: "node-create", nodeId: "node-b", ownerNodeId: "workspace", originalPlacement: null });
    facts.add({
      kind: "placement-create",
      placementId: "node-b-reference",
      nodeId: "node-b",
      parentNodeId: "workspace",
      anchor: end,
    });
    facts.add({
      kind: "node-create",
      nodeId: "node-b",
      ownerNodeId: "workspace",
      originalPlacement: { placementId: "placement-a", anchor: end },
    });

    const children =
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).childOccurrences.workspace ?? [];
    expect(children.indexOf("placement-a")).toBeLessThan(children.indexOf("anchored-placement"));
  });

  it("falls back to the latest valid Original selection", () => {
    const facts = base();
    facts.add({
      kind: "placement-create",
      placementId: "removed-reference",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    });
    facts.add({ kind: "placement-remove", placementId: "removed-reference" });
    facts.add({ kind: "original-promote", nodeId: "node", placementId: "removed-reference" });
    facts.add({ kind: "node-trash", nodeId: "node" });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.occurrences.occurrence?.nodeId).toBe("node");
    expect(projection.occurrences.occurrence?.parentNodeId).toBe(workspaceTrashNodeId("workspace"));
    expect(projection.nodeOwners.node).toBe(workspaceTrashNodeId("workspace"));
  });

  it("单人 Direct 全表面", () => {
    const facts = fullSurface("direct");
    facts.add({
      kind: "placement-remove",
      placementId: "reference",
    });
    facts.add({
      kind: "placement-create",
      placementId: "reference",
      nodeId: "node",
      parentNodeId: "moved-parent",
      anchor: end,
    });
    facts.add({ kind: "node-trash", nodeId: "node" });
    facts.add({
      kind: "node-restore",
      nodeId: "node",
      placementId: "reference",
      parentNodeId: "moved-parent",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projectionText(projection, "node")).toBe("AB");
    expect(projection.supertagApplications.node?.map(({ supertagId }) => supertagId)).toEqual(["supertag"]);
    expect(projection.nodeOwners.node).toBe("moved-parent");
    expect(projectSnapshot("workspace", facts.snapshot(), "review", versions)).toMatchObject({
      nodes: projection.nodes,
      occurrences: projection.occurrences,
    });
  });

  it("单人 Proposal 生命周期", () => {
    const facts = base("direct");
    const pending = facts.add(
      {
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "P",
      },
      "proposal",
    );
    expect(projectionText(projectSnapshot("workspace", facts.snapshot(), "origin", versions), "node")).toBe("");
    expect(projectionText(projectSnapshot("workspace", facts.snapshot(), "review", versions), "node")).toBe("P");
    facts.resolve([pending.id], "reject");
    expect(projectionText(projectSnapshot("workspace", facts.snapshot(), "review", versions), "node")).toBe("");

    const expectedKinds = [
      "field-configuration-set",
      "field-materialize",
      "field-value-remove",
      "inline-alias-attach",
      "inline-alias-detach",
      "inline-reference-create",
      "inline-reference-remove",
      "materialized-field-clear",
      "node-create",
      "node-trash",
      "node-restore",
      "original-promote",
      "placement-create",
      "placement-remove",
      "placement-move",
      "supertag-application-add",
      "supertag-extension-add",
      "supertag-extension-remove",
      "supertag-membership-remove",
      "template-member-add",
      "template-member-remove",
      "template-node-detach",
      "rich-text-mark",
      "rich-text-splice",
    ];
    expect(
      proposalLifecycleCases()
        .map((entry) => entry.kind)
        .sort(),
    ).toEqual(expectedKinds.sort());
    for (const decision of ["accept", "reject"] as const) {
      for (const entry of proposalLifecycleCases()) {
        const pendingSnapshot = entry.facts.snapshot();
        const pendingOrigin = projectSnapshot("workspace", pendingSnapshot, "origin", versions);
        const pendingReview = projectSnapshot("workspace", pendingSnapshot, "review", versions);
        expect(projectionPayload(pendingReview), `${entry.kind} must be pending in Review`).not.toEqual(
          projectionPayload(pendingOrigin),
        );
        const pendingHunk = queryReview(
          "workspace",
          pendingSnapshot,
          rebuildGeneration("workspace", pendingSnapshot, versions),
        ).hunks.find((hunk) => hunk.proposalActionIds.includes(entry.proposal.id));
        expect(pendingHunk, `${entry.kind} must have a typed Review Hunk`).toBeDefined();
        entry.facts.resolve(pendingHunk!.selection.evidence.supportClosure, decision);
        const terminalSnapshot = entry.facts.snapshot();
        const terminalOrigin = projectSnapshot("workspace", terminalSnapshot, "origin", versions);
        const terminalReview = projectSnapshot("workspace", terminalSnapshot, "review", versions);
        expect(projectionPayload(terminalReview), `${entry.kind} ${decision} must be terminal`).toEqual(
          projectionPayload(terminalOrigin),
        );
        expect(
          projectionPayload(terminalOrigin),
          `${entry.kind} ${decision} must preserve the selected pending side`,
        ).toEqual(projectionPayload(decision === "accept" ? pendingReview : pendingOrigin));
        expect(
          queryReview(
            "workspace",
            terminalSnapshot,
            rebuildGeneration("workspace", terminalSnapshot, versions),
          ).hunks.some((hunk) => hunk.proposalActionIds.includes(entry.proposal.id)),
        ).toBe(false);
      }
    }

    for (const decision of ["accept", "reject"] as const) {
      const surface = proposalLifecycleSurface();
      const pendingOrigin = projectSnapshot("workspace", surface.facts.snapshot(), "origin", versions);
      const pendingReview = projectSnapshot("workspace", surface.facts.snapshot(), "review", versions);
      expect(projectionPayload(pendingReview)).not.toEqual(projectionPayload(pendingOrigin));
      surface.facts.resolve(surface.proposalIds, decision);
      const terminalOrigin = projectSnapshot("workspace", surface.facts.snapshot(), "origin", versions);
      const terminalReview = projectSnapshot("workspace", surface.facts.snapshot(), "review", versions);
      expect(projectionPayload(terminalReview)).toEqual(projectionPayload(terminalOrigin));
      expect(terminalOrigin.nodes["proposal-node"] !== undefined).toBe(decision === "accept");
    }
  });

  it("renders a self-reference once as a non-recursive Reference", () => {
    const facts = base();
    facts.add({
      kind: "placement-create",
      placementId: "self",
      nodeId: "node",
      parentNodeId: "node",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "review", versions);
    expect(projection.occurrences.self?.nodeId).toBe("node");
    expect(projection.childOccurrences.node).toEqual(["self"]);
    expect(renderSemanticTree(projection, "occurrence")?.childOccurrences[0]).toMatchObject({
      occurrenceId: "self",
      nodeId: "node",
      reference: true,
      childOccurrences: [],
    });
  });

  it("moves a Reference without changing Owner authority", () => {
    const facts = base();
    addPlacedNode(facts, "reference-parent");
    addPlacedNode(facts, "destination");
    facts.add({
      kind: "placement-create",
      placementId: "reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    });
    facts.add({
      kind: "placement-move",
      placementId: "reference",
      parentNodeId: "destination",
      anchor: end,
    });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodeOwners.node).toBe("workspace");
    expect(projection.occurrences.occurrence?.parentNodeId).toBe("workspace");
    expect(projection.occurrences.reference?.parentNodeId).toBe("destination");
  });

  it("Lifecycle delete/restore", () => {
    const facts = base();
    facts.add({
      kind: "placement-remove",
      placementId: "occurrence",
    });
    facts.add({
      kind: "placement-create",
      placementId: "occurrence",
      nodeId: "node",
      parentNodeId: "workspace",
      anchor: end,
    });
    expect(projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences.occurrence).toBeDefined();

    facts.add({ kind: "node-trash", nodeId: "node" });
    addPlacedNode(facts, "late-parent");
    facts.add({
      kind: "placement-create",
      placementId: "late-old-occurrence",
      nodeId: "node",
      parentNodeId: "late-parent",
      anchor: end,
    });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences["late-old-occurrence"],
    ).toBeDefined();
    facts.add({
      kind: "node-restore",
      nodeId: "node",
      placementId: "occurrence",
      parentNodeId: "workspace",
      anchor: end,
    });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences["late-old-occurrence"],
    ).toBeDefined();
    facts.add({ kind: "node-trash", nodeId: "node" });
    expect(projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodeOwners.node).toBe(
      workspaceTrashNodeId("workspace"),
    );
  });
});

function proposalLifecycleSurface(): Readonly<{
  facts: Facts;
  proposalIds: readonly FactActionId[];
}> {
  const facts = base();
  const initial = facts.add({
    kind: "rich-text-splice",
    nodeId: "node",
    deleteAtomIds: [],
    anchor: end,
    insert: "A",
  });
  facts.add({ kind: "node-create", nodeId: "target", ownerNodeId: "workspace", originalPlacement: null });
  facts.add({ kind: "node-create", nodeId: "owner-target", ownerNodeId: "workspace", originalPlacement: null });
  facts.add({
    kind: "placement-create",
    placementId: "target",
    nodeId: "target",
    parentNodeId: "owner-target",
    anchor: end,
  });
  facts.add({
    kind: "placement-create",
    placementId: "reference",
    nodeId: "node",
    parentNodeId: "workspace",
    anchor: end,
  });
  const proposalIds = [
    facts.add(
      {
        kind: "rich-text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "P",
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "rich-text-mark",
        nodeId: "node",
        atomIds: [`${initial.id}#0`],
        key: "bold",
        value: { kind: "set", value: true },
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "placement-move",
        placementId: "occurrence",
        parentNodeId: "target",
        anchor: end,
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "node-create",
        nodeId: "proposal-node",
        ownerNodeId: "workspace",
        originalPlacement: { placementId: "proposal-occurrence", anchor: end },
      },
      "proposal",
    ).id,
  ];
  return { facts, proposalIds };
}

function projectionPayload(projection: ReturnType<typeof projectSnapshot>) {
  return {
    nodes: projection.nodes,
    occurrences: projection.occurrences,
    childOccurrences: projection.childOccurrences,
    nodeOwners: projection.nodeOwners,
    supertagApplications: projection.supertagApplications,
    supertagTemplateNodes: projection.supertagTemplateNodes,
    templateNodeInstances: projection.templateNodeInstances,
    supertagExtensions: projection.supertagExtensions,
    supertagInstanceSupertags: projection.supertagInstanceSupertags,
    conflictIssues: projection.conflictIssues,
    materializedFields: projection.materializedFields,
    sharedDefaultViewDefinitions: projection.sharedDefaultViewDefinitions,
    fieldDefinitionConfigurations: projection.fieldDefinitionConfigurations,
  };
}
