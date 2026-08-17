import { describe, expect, it } from "vitest";

import { workspaceTrashNodeId } from "../fact/index.js";
import { queryReview } from "../review/index.js";
import { nodeLocation, rebuildGeneration } from "./index.js";
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
    unattachedFacts.add({ kind: "node-create", nodeId: "node" });
    const unattached = projectSnapshot("workspace", unattachedFacts.snapshot(), "origin", versions);
    expect(unattached.nodes.node).toBeDefined();
    expect(unattached.nodeOwners.node).toBeUndefined();

    const placed = projectSnapshot("workspace", base().snapshot(), "origin", versions);
    expect(placed.nodeOwners.node).toBe("workspace");
  });

  it("attaches one persistent Metanode without creating a visible Outline Occurrence", () => {
    const facts = base();
    facts.addTransaction([
      { kind: "node-create", nodeId: "node-configuration" },
      {
        kind: "metanode-attach",
        hostNodeId: "node",
        metanodeId: "node-configuration",
      },
    ]);

    const active = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(active.metanodes).toEqual({ node: "node-configuration" });
    expect(active.nodeOwners["node-configuration"]).toBe("node");
    expect(Object.values(active.occurrences).some((occurrence) => occurrence.nodeId === "node-configuration")).toBe(
      false,
    );
    expect(active.childOccurrences.node ?? []).not.toContain("node-configuration");

    facts.add({ kind: "node-delete", nodeId: "node" });
    const deleted = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(nodeLocation("workspace", deleted, "node-configuration")).toBe("trash");
  });

  it("keeps Owner authority independent from a non-owning Reference edge", () => {
    const facts = base();
    addPlacedNode(facts, "parent");
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "node-reference",
      nodeId: "node",
      parentNodeId: "parent",
      anchor: end,
    });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodeOwners.node).toBe("workspace");
    expect(projection.occurrences["node-reference"]?.parentNodeId).toBe("parent");
  });

  it("单人 Direct 全表面", () => {
    const facts = fullSurface("direct");
    const occurrenceDeletion = facts.add({
      kind: "occurrence-delete",
      occurrenceId: "reference",
    });
    facts.add({
      kind: "occurrence-restore",
      occurrenceId: "reference",
      deletionFactId: occurrenceDeletion.id,
      parentNodeId: "moved-parent",
      anchor: end,
    });
    const nodeDeletion = facts.add({ kind: "node-delete", nodeId: "node" });
    facts.add({ kind: "node-restore", nodeId: "node", deletionFactId: nodeDeletion.id });
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
        kind: "text-splice",
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
      "field-cardinality-configure",
      "field-datatype-configure",
      "field-initialization-expression-configure",
      "field-materialize",
      "field-optionality-configure",
      "field-value-delete",
      "inline-reference-alias-attach",
      "inline-reference-alias-detach",
      "inline-reference-create",
      "inline-reference-delete",
      "intrinsic-node-type-declare",
      "materialized-field-delete",
      "node-create",
      "node-delete",
      "node-owner-set",
      "node-restore",
      "occurrence-create",
      "occurrence-delete",
      "occurrence-move",
      "occurrence-restore",
      "shared-default-view-definition-mode-set",
      "supertag-apply",
      "supertag-extension-add",
      "supertag-extension-remove",
      "supertag-remove",
      "supertag-template-node-add",
      "supertag-template-node-remove",
      "template-node-detach",
      "text-mark",
      "text-splice",
    ];
    expect(
      proposalLifecycleCases()
        .map((entry) => entry.kind)
        .sort(),
    ).toEqual(expectedKinds);
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
          rebuildGeneration("workspace", pendingSnapshot, versions).generation,
        ).hunks.find((hunk) => hunk.proposalContributionIds.includes(entry.proposal.id));
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
            rebuildGeneration("workspace", terminalSnapshot, versions).generation,
          ).hunks.some((hunk) => hunk.proposalContributionIds.includes(entry.proposal.id)),
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
      kind: "occurrence-create",
      occurrenceId: "self",
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

  it("moves a non-owning edge without changing Owner authority", () => {
    const facts = base();
    addPlacedNode(facts, "reference-parent");
    addPlacedNode(facts, "destination");
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "reference",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    });
    facts.add({
      kind: "node-owner-set",
      nodeId: "node",
      ownerNodeId: "reference-parent",
      previousOwnerNodeId: "workspace",
    });
    facts.add({
      kind: "occurrence-move",
      occurrenceId: "reference",
      parentNodeId: "destination",
      anchor: end,
      previousParentNodeId: "reference-parent",
      previousAnchor: end,
    });

    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projection.nodeOwners.node).toBe("reference-parent");
    expect(projection.occurrences.occurrence?.parentNodeId).toBe("workspace");
    expect(projection.occurrences.reference?.parentNodeId).toBe("destination");
  });

  it("Lifecycle delete/restore", () => {
    const facts = base();
    const deletion = facts.add({
      kind: "occurrence-delete",
      occurrenceId: "occurrence",
    });
    facts.add({
      kind: "occurrence-restore",
      occurrenceId: "occurrence",
      deletionFactId: deletion.id,
      parentNodeId: "workspace",
      anchor: end,
    });
    expect(projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences.occurrence).toBeDefined();

    const nodeDelete = facts.add({ kind: "node-delete", nodeId: "node" });
    addPlacedNode(facts, "late-parent");
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "late-old-occurrence",
      nodeId: "node",
      parentNodeId: "late-parent",
      anchor: end,
    });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences["late-old-occurrence"],
    ).toBeDefined();
    facts.add({ kind: "node-restore", nodeId: "node", deletionFactId: nodeDelete.id });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences["late-old-occurrence"],
    ).toBeDefined();
    facts.add({ kind: "node-delete", nodeId: "node" });
    expect(projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodeOwners.node).toBe(
      workspaceTrashNodeId("workspace"),
    );
  });
});

function proposalLifecycleSurface(): Readonly<{
  facts: Facts;
  proposalIds: readonly string[];
}> {
  const facts = base();
  const initial = facts.add({
    kind: "text-splice",
    nodeId: "node",
    deleteAtomIds: [],
    anchor: end,
    insert: "A",
  });
  facts.add({ kind: "node-create", nodeId: "target" });
  facts.add({ kind: "node-create", nodeId: "owner-target" });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "target",
    nodeId: "target",
    parentNodeId: "owner-target",
    anchor: end,
  });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "reference",
    nodeId: "node",
    parentNodeId: "workspace",
    anchor: end,
  });
  const proposalIds = [
    facts.add(
      {
        kind: "text-splice",
        nodeId: "node",
        deleteAtomIds: [],
        anchor: end,
        insert: "P",
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "text-mark",
        nodeId: "node",
        atomIds: [`${initial.id}#0`],
        key: "bold",
        value: { kind: "set", value: true },
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "occurrence-move",
        occurrenceId: "occurrence",
        parentNodeId: "target",
        anchor: end,
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "node-owner-set",
        nodeId: "node",
        ownerNodeId: "owner-target",
      },
      "proposal",
    ).id,
    facts.add({ kind: "node-create", nodeId: "proposal-node" }, "proposal").id,
    facts.add(
      {
        kind: "occurrence-create",
        occurrenceId: "proposal-occurrence",
        nodeId: "proposal-node",
        parentNodeId: "workspace",
        anchor: end,
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
