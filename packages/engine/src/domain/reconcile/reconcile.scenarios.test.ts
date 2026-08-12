import { describe, expect, it } from "vitest";

import { queryReview } from "../review/index.js";
import { projectSnapshot, projectionText, rebuildGeneration, renderSemanticTree } from "./index.js";
import { proposalLifecycleCases } from "./proposal-lifecycle-test-helpers.js";
import { base, end, fullSurface, versions } from "./reconcile-test-helpers.js";
import type { Facts } from "./reconcile-test-helpers.js";

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
    expect(projection.nodes.node?.properties).toMatchObject({ color: "blue" });
    expect(projection.schemaApplications.node).toEqual(["schema"]);
    expect(projection.effectiveFields.node?.[0]?.fieldDefinitionId).toBe("field");
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
      "field-initialize",
      "field-materialize",
      "field-value-delete",
      "materialized-field-delete",
      "node-create",
      "node-delete",
      "node-restore",
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
    schemaApplications: projection.schemaApplications,
    schemaFields: projection.schemaFields,
    schemaFieldItems: projection.schemaFieldItems,
    schemaTemplateNodes: projection.schemaTemplateNodes,
    templateNodeInstances: projection.templateNodeInstances,
    schemaExtensions: projection.schemaExtensions,
    schemaSearchMembers: projection.schemaSearchMembers,
    definitionStatuses: projection.definitionStatuses,
    conflictIssues: projection.conflictIssues,
    effectiveFields: projection.effectiveFields,
    materializedFields: projection.materializedFields,
  };
}
