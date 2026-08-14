import { describe, expect, it } from "vitest";

import { compareFacts, frontierOf, makeFact, type Mutation } from "../fact/index.js";
import { queryReview } from "../review/index.js";
import { rebuildGeneration } from "./index.js";
import { projectSnapshot, projectionText } from "../../../tests/support/reconcile/projection.js";
import { renderSemanticTree } from "../../../tests/support/reconcile/semantic-tree.js";
import { proposalLifecycleCases } from "../../../tests/support/reconcile/proposal-lifecycle-test-helpers.js";
import {
  base,
  end,
  Facts,
  fullSurface,
  versions,
} from "../../../tests/support/reconcile/reconcile-test-helpers.js";
import { addPlacedNode } from "../../../tests/support/reconcile/placed-node-test-helpers.js";

describe("production Reconcile scenarios", () => {
  it("projects the Workspace as the root Node and gives every other Node one explicit owner", () => {
    const rootFacts = new Facts();
    const root = projectSnapshot("workspace", rootFacts.snapshot(), "origin", versions);
    expect(root.identity.workspaceNodeId).toBe("workspace");
    expect(root.nodes.workspace).toEqual({
      nodeId: "workspace",
      text: [],
      properties: {},
      metadata: {},
    });
    expect(root.nodeOwners.workspace).toBeNull();

    const unattachedFacts = new Facts();
    unattachedFacts.add({ kind: "node-create", nodeId: "node" });
    const unattached = projectSnapshot("workspace", unattachedFacts.snapshot(), "origin", versions);
    expect(unattached.nodes.node).toBeDefined();
    expect(unattached.nodeOwners.node).toBeUndefined();
    expect(unattached.nodeStatuses.node).toBeUndefined();

    const placed = projectSnapshot("workspace", base().snapshot(), "origin", versions);
    expect(placed.nodeOwners.node).toBe("workspace");
  });

  it("does not let a concurrent Reference steal the Original placement", () => {
    const localReplica = "zzzzzzzzzzzzzzzzzzzzzzzzzz";
    const remoteReplica = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const nodeOriginal = contribution(
      localReplica,
      5,
      { [localReplica]: 4 },
      {
        kind: "occurrence-create",
        occurrenceId: "node-original",
        nodeId: "node",
        parentNodeId: "workspace",
        anchor: end,
      },
    );
    const nodeReference = contribution(
      remoteReplica,
      1,
      { [localReplica]: 4 },
      {
        kind: "occurrence-create",
        occurrenceId: "node-reference",
        nodeId: "node",
        parentNodeId: "parent",
        anchor: end,
      },
    );
    const facts = [
      contribution(localReplica, 1, {}, { kind: "node-create", nodeId: "workspace" }),
      contribution(
        localReplica,
        2,
        { [localReplica]: 1 },
        { kind: "node-create", nodeId: "parent" },
      ),
      contribution(
        localReplica,
        3,
        { [localReplica]: 2 },
        {
          kind: "occurrence-create",
          occurrenceId: "parent-original",
          nodeId: "parent",
          parentNodeId: "workspace",
          anchor: end,
        },
      ),
      contribution(localReplica, 4, { [localReplica]: 3 }, { kind: "node-create", nodeId: "node" }),
      nodeOriginal,
      nodeReference,
    ];
    const snapshot = { facts: [...facts].reverse(), frontier: frontierOf(facts) };
    const ordered = [...facts].sort(compareFacts);

    expect(ordered.indexOf(nodeReference)).toBeLessThan(ordered.indexOf(nodeOriginal));

    const projection = projectSnapshot("workspace", snapshot, "origin", versions);

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
    facts.add({
      kind: "value-set",
      target: { kind: "node", id: "node" },
      namespace: "metadata",
      key: "favorite",
      value: true,
    });
    facts.add({
      kind: "value-unset",
      target: { kind: "node", id: "node" },
      namespace: "property",
      key: "color",
    });
    facts.add({
      kind: "value-set",
      target: { kind: "node", id: "node" },
      namespace: "property",
      key: "color",
      value: "blue",
    });
    const nodeDeletion = facts.add({ kind: "node-delete", nodeId: "node" });
    facts.add({ kind: "node-restore", nodeId: "node", deletionFactId: nodeDeletion.id });
    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projectionText(projection, "node")).toBe("AB");
    expect(projection.nodes.node?.properties).toMatchObject({ color: "blue" });
    expect(projection.schemaApplications.node).toEqual(["schema"]);
    expect(projection.effectiveFields.node?.[0]?.fieldDefinitionId).toBe("field");
    expect(projection.nodeOwners.node).toBe("moved-parent");
    expect(projection.nodes.node?.metadata.favorite).toBe(true);
    expect(projectSnapshot("workspace", facts.snapshot(), "review", versions)).toMatchObject({
      nodes: projection.nodes,
      occurrences: projection.occurrences,
    });
  });

  it("单人 Proposal 生命周期", () => {
    const facts = base("direct");
    const pending = facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "property",
        key: "p",
        value: 1,
      },
      "proposal",
    );
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodes.node?.properties.p,
    ).toBeUndefined();
    expect(
      projectSnapshot("workspace", facts.snapshot(), "review", versions).nodes.node?.properties.p,
    ).toBe(1);
    facts.resolve([pending.id], "reject");
    expect(
      projectSnapshot("workspace", facts.snapshot(), "review", versions).nodes.node?.properties.p,
    ).toBeUndefined();

    const expectedKinds = [
      "field-initialize",
      "field-materialize",
      "field-value-delete",
      "materialized-field-delete",
      "node-create",
      "node-delete",
      "node-owner-set",
      "node-restore",
      "node-type-declare",
      "occurrence-create",
      "occurrence-delete",
      "occurrence-move",
      "occurrence-restore",
      "schema-apply",
      "schema-extension-add",
      "schema-extension-remove",
      "schema-field-add",
      "schema-field-configure",
      "schema-field-remove",
      "schema-remove",
      "schema-template-node-add",
      "schema-template-node-remove",
      "template-node-detach",
      "text-mark",
      "text-splice",
      "value-set",
      "value-unset",
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
        expect(
          projectionPayload(pendingReview),
          `${entry.kind} must be pending in Review`,
        ).not.toEqual(projectionPayload(pendingOrigin));
        const pendingHunk = queryReview(
          "workspace",
          pendingSnapshot,
          rebuildGeneration("workspace", pendingSnapshot, versions).generation,
        ).hunks.find((hunk) => hunk.proposalContributionIds.includes(entry.proposal.id));
        expect(pendingHunk, `${entry.kind} must have a typed Review Hunk`).toBeDefined();
        if (entry.kind === "schema-field-configure") {
          expect(pendingHunk?.diffSpace.kind).toBe("field-configuration");
          expect(pendingHunk?.selection.evidence.effects).toEqual([
            expect.objectContaining({ kind: "field-configuration" }),
          ]);
          expect(pendingHunk?.selection.evidence.associatedImpactIds.length).toBeGreaterThan(0);
        }
        entry.facts.resolve(pendingHunk!.selection.evidence.supportClosure, decision);
        const terminalSnapshot = entry.facts.snapshot();
        const terminalOrigin = projectSnapshot("workspace", terminalSnapshot, "origin", versions);
        const terminalReview = projectSnapshot("workspace", terminalSnapshot, "review", versions);
        expect(
          projectionPayload(terminalReview),
          `${entry.kind} ${decision} must be terminal`,
        ).toEqual(projectionPayload(terminalOrigin));
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
      const pendingOrigin = projectSnapshot(
        "workspace",
        surface.facts.snapshot(),
        "origin",
        versions,
      );
      const pendingReview = projectSnapshot(
        "workspace",
        surface.facts.snapshot(),
        "review",
        versions,
      );
      expect(projectionPayload(pendingReview)).not.toEqual(projectionPayload(pendingOrigin));
      surface.facts.resolve(surface.proposalIds, decision);
      const terminalOrigin = projectSnapshot(
        "workspace",
        surface.facts.snapshot(),
        "origin",
        versions,
      );
      const terminalReview = projectSnapshot(
        "workspace",
        surface.facts.snapshot(),
        "review",
        versions,
      );
      expect(projectionPayload(terminalReview)).toEqual(projectionPayload(terminalOrigin));
      expect(terminalOrigin.nodes["proposal-node"] !== undefined).toBe(decision === "accept");
    }
  });

  it("Transclusion 与 self-reference", () => {
    const facts = base();
    addPlacedNode(facts, "reference-parent");
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "second-appearance",
      nodeId: "node",
      parentNodeId: "reference-parent",
      anchor: end,
    });
    facts.add({
      kind: "text-splice",
      nodeId: "node",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      insert: "shared",
      deleteAtomIds: [],
    });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "self",
      nodeId: "node",
      parentNodeId: "node",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "review", versions);
    expect(projection.occurrences.self?.nodeId).toBe("node");
    expect(projection.children.node).toEqual(["self"]);
    const firstAppearance = projection.occurrences.occurrence;
    const secondAppearance = projection.occurrences["second-appearance"];
    expect(firstAppearance).toBeDefined();
    expect(secondAppearance).toBeDefined();
    expect(projection.nodes[firstAppearance?.nodeId ?? ""]?.text).toEqual(
      projection.nodes[secondAppearance?.nodeId ?? ""]?.text,
    );
    expect(renderSemanticTree(projection, "occurrence")?.children[0]).toMatchObject({
      occurrenceId: "self",
      nodeId: "node",
      reference: true,
      children: [],
    });
  });

  it("moves ownership with the uniquely selected Original placement", () => {
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
    expect(projection.nodeOwners.node).toBe("destination");
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
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences.occurrence,
    ).toBeDefined();

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
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences[
        "late-old-occurrence"
      ],
    ).toBeUndefined();
    facts.add({ kind: "node-restore", nodeId: "node", deletionFactId: nodeDelete.id });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences[
        "late-old-occurrence"
      ],
    ).toBeDefined();
    facts.add({ kind: "node-delete", nodeId: "node" });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).nodes.node,
    ).toBeUndefined();
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
        kind: "value-set",
        target: { kind: "node", id: "node" },
        namespace: "metadata",
        key: "reviewed",
        value: true,
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "schema" },
        namespace: "schema",
        key: "field",
        value: 0,
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "value-set",
        target: { kind: "node", id: "field" },
        namespace: "metadata",
        key: "label",
        value: "Field",
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
    children: projection.children,
    nodeOwners: projection.nodeOwners,
    addressedValues: projection.addressedValues,
    schemaApplications: projection.schemaApplications,
    schemaFields: projection.schemaFields,
    templateFields: projection.templateFields,
    schemaTemplateNodes: projection.schemaTemplateNodes,
    templateNodeInstances: projection.templateNodeInstances,
    schemaExtensions: projection.schemaExtensions,
    schemaSearchMembers: projection.schemaSearchMembers,
    nodeStatuses: projection.nodeStatuses,
    conflictIssues: projection.conflictIssues,
    effectiveFields: projection.effectiveFields,
    materializedFields: projection.materializedFields,
  };
}

function contribution(
  replicaId: string,
  sequence: number,
  observed: Readonly<Record<string, number>>,
  mutation: Mutation,
) {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence,
    observed,
    lamport: sequence,
    body: { kind: "contribution", actorId: replicaId, intent: "direct", mutation },
  });
}
