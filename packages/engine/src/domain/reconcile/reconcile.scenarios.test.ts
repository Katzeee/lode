import { describe, expect, it } from "vitest";

import { queryReview } from "../review/index.js";
import { projectSnapshot, projectionText, rebuildGeneration, renderSemanticTree } from "./index.js";
import { proposalLifecycleCases } from "./proposal-lifecycle-test-helpers.js";
import { managedNodeId, managedOccurrenceId } from "./managed-identity.js";
import { base, end, Facts, fullSurface, versions } from "./reconcile-test-helpers.js";

describe("production Reconcile scenarios", () => {
  it("单人 Direct 全表面", () => {
    const facts = fullSurface("direct");
    const occurrenceDeletion = facts.add({
      kind: "occurrence-delete",
      occurrenceId: "reference",
      childPolicy: "rehome",
    });
    facts.add({
      kind: "occurrence-restore",
      occurrenceId: "reference",
      deletionFactId: occurrenceDeletion.id,
      parentOccurrenceId: "occurrence",
      anchor: end,
    });
    facts.add({
      kind: "value-set",
      owner: { kind: "node", id: "node" },
      namespace: "metadata",
      key: "favorite",
      value: true,
    });
    facts.add({
      kind: "value-unset",
      owner: { kind: "node", id: "node" },
      namespace: "property",
      key: "color",
    });
    facts.add({
      kind: "value-set",
      owner: { kind: "node", id: "node" },
      namespace: "property",
      key: "color",
      value: "blue",
    });
    const nodeDeletion = facts.add({ kind: "node-delete", nodeId: "node" });
    facts.add({ kind: "node-restore", nodeId: "node", deletionFactId: nodeDeletion.id });
    const projection = projectSnapshot("workspace", facts.snapshot(), "origin", versions);
    expect(projectionText(projection, "node")).toBe("AB");
    expect(projection.nodes.node?.properties).toMatchObject({
      color: "blue",
      schemaId: "schema",
    });
    expect(projection.managedChildren).toHaveLength(1);
    expect(projection.canonicalOccurrences.node).toBe("reference");
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
        owner: { kind: "node", id: "node" },
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
      "canonical-occurrence-set",
      "node-create",
      "node-delete",
      "node-restore",
      "occurrence-create",
      "occurrence-delete",
      "occurrence-move",
      "occurrence-restore",
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
        expect(
          queryReview(
            "workspace",
            pendingSnapshot,
            rebuildGeneration("workspace", pendingSnapshot, versions).generation,
          ).hunks.some((hunk) => hunk.proposalContributionIds.includes(entry.proposal.id)),
        ).toBe(true);
        entry.facts.resolve([entry.proposal.id], decision);
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

  it("Schema 与 managed children", () => {
    const projection = projectSnapshot(
      "workspace",
      fullSurface("direct").snapshot(),
      "origin",
      versions,
    );
    expect(projection.managedChildren[0]).toMatchObject({
      parentNodeId: "node",
      schemaId: "schema",
      fieldId: "field",
    });
    expect(projection.occurrences[managedOccurrenceId("node", "schema", "field")]).toMatchObject({
      managed: true,
      parentOccurrenceId: "reference",
    });

    const evolving = fullSurface("direct");
    evolving.add({
      kind: "text-splice",
      nodeId: managedNodeId("node", "schema", "field"),
      deleteAtomIds: [],
      anchor: end,
      insert: "kept value",
    });
    evolving.add({
      kind: "value-unset",
      owner: { kind: "schema", id: "schema" },
      namespace: "schema",
      key: "field",
    });
    evolving.add({
      kind: "value-set",
      owner: { kind: "schema", id: "schema" },
      namespace: "schema",
      key: "replacement",
      value: 1,
    });
    const evolved = projectSnapshot("workspace", evolving.snapshot(), "origin", versions);
    expect(evolved.managedChildren.map((child) => child.fieldId)).toEqual(["replacement"]);
    expect(projectionText(evolved, managedNodeId("node", "schema", "field"))).toBe("kept value");
    expect(evolved.occurrences[managedOccurrenceId("node", "schema", "field")]).toMatchObject({
      managed: false,
      parentOccurrenceId: "reference",
    });

    const reordered = fullSurface("direct");
    reordered.add({
      kind: "value-set",
      owner: { kind: "schema", id: "schema" },
      namespace: "schema",
      key: "second",
      value: 1,
      previous: { kind: "unset" },
    });
    const proposalReorder = reordered.add(
      {
        kind: "value-set",
        owner: { kind: "schema", id: "schema" },
        namespace: "schema",
        key: "second",
        value: -1,
        previous: { kind: "set", value: 1 },
      },
      "proposal",
    );
    const pending = reordered.snapshot();
    expect(
      projectSnapshot("workspace", pending, "origin", versions).managedChildren.map(
        (child) => child.fieldId,
      ),
    ).toEqual(["field", "second"]);
    expect(
      projectSnapshot("workspace", pending, "review", versions).managedChildren.map(
        (child) => child.fieldId,
      ),
    ).toEqual(["second", "field"]);
    reordered.resolve([proposalReorder.id], "accept");
    expect(
      projectSnapshot("workspace", reordered.snapshot(), "origin", versions).managedChildren.map(
        (child) => child.fieldId,
      ),
    ).toEqual(["second", "field"]);

    const collision = new Facts();
    for (const [nodeId, occurrenceId] of [
      ["a:b", "o1"],
      ["a", "o2"],
    ] as const) {
      collision.add({ kind: "node-create", nodeId });
      collision.add({
        kind: "occurrence-create",
        occurrenceId,
        nodeId,
        parentOccurrenceId: null,
        parentPolicy: "cascade",
        anchor: end,
      });
    }
    collision.add({
      kind: "value-set",
      owner: { kind: "node", id: "a:b" },
      namespace: "property",
      key: "schemaId",
      value: "c",
    });
    collision.add({
      kind: "value-set",
      owner: { kind: "node", id: "a" },
      namespace: "property",
      key: "schemaId",
      value: "b",
    });
    collision.add({
      kind: "value-set",
      owner: { kind: "schema", id: "c" },
      namespace: "schema",
      key: "d",
      value: 0,
    });
    collision.add({
      kind: "value-set",
      owner: { kind: "schema", id: "b" },
      namespace: "schema",
      key: "c:d",
      value: 0,
    });
    const collisionProjection = projectSnapshot(
      "workspace",
      collision.snapshot(),
      "origin",
      versions,
    );
    expect(collisionProjection.managedChildren.map((child) => child.nodeId).sort()).toEqual(
      [managedNodeId("a:b", "c", "d"), managedNodeId("a", "b", "c:d")].sort(),
    );
    expect(
      collisionProjection.occurrences[managedOccurrenceId("a:b", "c", "d")]?.parentOccurrenceId,
    ).toBe("o1");
    expect(
      collisionProjection.occurrences[managedOccurrenceId("a", "b", "c:d")]?.parentOccurrenceId,
    ).toBe("o2");
  });

  it("Transclusion 与 self-reference", () => {
    const facts = base();
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "second-appearance",
      nodeId: "node",
      parentOccurrenceId: null,
      parentPolicy: "cascade",
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
      parentOccurrenceId: "occurrence",
      parentPolicy: "cascade",
      anchor: end,
    });
    const projection = projectSnapshot("workspace", facts.snapshot(), "review", versions);
    expect(projection.occurrences.self?.nodeId).toBe("node");
    expect(projection.children.occurrence).toEqual(["self"]);
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

  it("Lifecycle delete/restore", () => {
    const facts = base();
    const deletion = facts.add({
      kind: "occurrence-delete",
      occurrenceId: "occurrence",
      childPolicy: "rehome",
    });
    facts.add({
      kind: "occurrence-restore",
      occurrenceId: "occurrence",
      deletionFactId: deletion.id,
      parentOccurrenceId: null,
      anchor: end,
    });
    expect(
      projectSnapshot("workspace", facts.snapshot(), "origin", versions).occurrences.occurrence,
    ).toBeDefined();

    const nodeDelete = facts.add({ kind: "node-delete", nodeId: "node" });
    facts.add({
      kind: "occurrence-create",
      occurrenceId: "late-old-occurrence",
      nodeId: "node",
      parentOccurrenceId: null,
      parentPolicy: "cascade",
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
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "target",
    nodeId: "target",
    parentOccurrenceId: null,
    parentPolicy: "cascade",
    anchor: end,
  });
  facts.add({
    kind: "occurrence-create",
    occurrenceId: "reference",
    nodeId: "node",
    parentOccurrenceId: null,
    parentPolicy: "cascade",
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
        owner: { kind: "node", id: "node" },
        namespace: "metadata",
        key: "reviewed",
        value: true,
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "value-set",
        owner: { kind: "schema", id: "schema" },
        namespace: "schema",
        key: "field",
        value: 0,
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "value-set",
        owner: { kind: "field", id: "field" },
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
        parentOccurrenceId: "target",
        anchor: end,
      },
      "proposal",
    ).id,
    facts.add(
      {
        kind: "canonical-occurrence-set",
        nodeId: "node",
        occurrenceId: "reference",
      },
      "proposal",
    ).id,
    facts.add({ kind: "node-create", nodeId: "proposal-node" }, "proposal").id,
    facts.add(
      {
        kind: "occurrence-create",
        occurrenceId: "proposal-occurrence",
        nodeId: "proposal-node",
        parentOccurrenceId: null,
        parentPolicy: "cascade",
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
    canonicalOccurrences: projection.canonicalOccurrences,
    addressedValues: projection.addressedValues,
    managedChildren: projection.managedChildren,
  };
}
