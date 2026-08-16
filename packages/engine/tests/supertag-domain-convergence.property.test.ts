import { describe, expect, it } from "vitest";

import { frontierOf, type Fact, type FactFrontier, type Mutation } from "../src/domain/fact/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import { assertSupertagConvergence, remoteBranch } from "./supertag-convergence-property-helpers.js";

const B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddddd";
const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;

describe("Supertag domain convergence matrix", () => {
  it("preserves concurrent Supertag Application observed-remove intent across 32 four-replica topologies", () => {
    const base = relationBase(["supertag", "task", "unrelated"]);
    base.add({ kind: "supertag-apply", nodeId: "task", supertagId: "supertag", anchor: end });
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [
        { kind: "supertag-remove", nodeId: "task", supertagId: "supertag", previousAnchor: start },
      ]),
      ...remoteBranch(C, frontier, base.values.length + 1, [
        { kind: "supertag-apply", nodeId: "task", supertagId: "supertag", anchor: end },
      ]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      expect(generation.origin.supertagApplications.task).toEqual(["supertag"]);
      expect(generation.review.supertagApplications).toEqual(generation.origin.supertagApplications);
    });
  });

  it("keeps Field removal complete across a concurrent duplicate Contribution", () => {
    const base = relationBase(["supertag", "field", "task", "unrelated"]);
    base.add({
      kind: "supertag-field-add",
      supertagId: "supertag",
      fieldDefinitionId: "field",
      fieldNodeId: "supertag-field-template-field",
      fieldOccurrenceId: "supertag-field-template-field-occurrence",
      anchor: end,
    });
    base.add({ kind: "supertag-apply", nodeId: "task", supertagId: "supertag", anchor: end });
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [
        {
          kind: "supertag-field-remove",
          supertagId: "supertag",
          fieldDefinitionId: "field",
          fieldNodeId: "supertag-field-template-field",
          fieldOccurrenceId: "supertag-field-template-field-occurrence",
          previousAnchor: start,
        },
        { kind: "node-delete", nodeId: "supertag-field-template-field" },
      ]),
      ...remoteBranch(C, frontier, base.values.length + 1, [
        {
          kind: "supertag-field-add",
          supertagId: "supertag",
          fieldDefinitionId: "field",
          fieldNodeId: "supertag-field-template-field",
          fieldOccurrenceId: "supertag-field-template-field-occurrence",
          anchor: end,
        },
      ]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      expect(generation.origin.supertagFields.supertag).toBeUndefined();
      expect(generation.origin.effectiveFields.task).toEqual([]);
    });
  });

  it("preserves concurrent Extension observed-remove intent and inherited search closure", () => {
    const base = relationBase(["derived", "base", "field", "task", "unrelated"]);
    base.add({
      kind: "supertag-field-add",
      supertagId: "base",
      fieldDefinitionId: "field",
      fieldNodeId: "base-field-template-field",
      fieldOccurrenceId: "base-field-template-field-occurrence",
      anchor: end,
    });
    base.add({
      kind: "supertag-extension-add",
      supertagId: "derived",
      baseSupertagId: "base",
      anchor: end,
    });
    base.add({ kind: "supertag-apply", nodeId: "task", supertagId: "derived", anchor: end });
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [
        {
          kind: "supertag-extension-remove",
          supertagId: "derived",
          baseSupertagId: "base",
          previousAnchor: start,
        },
      ]),
      ...remoteBranch(C, frontier, base.values.length + 1, [
        { kind: "supertag-extension-add", supertagId: "derived", baseSupertagId: "base", anchor: end },
      ]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      expect(generation.origin.supertagExtensions.derived).toEqual(["base"]);
      expect(generation.origin.supertagInstanceSupertags.base).toEqual(["base", "derived"]);
      expect(generation.origin.effectiveFields.task?.[0]?.fieldDefinitionId).toBe("field");
    });
  });

  it("merges concurrent authored materializations without losing either value or identity", () => {
    const base = materializationBase();
    const frontier = frontierOf(base.values);
    const branchB = materializationBranch(B, frontier, base.values.length + 1, "offline-a", "Alpha");
    const branchC = materializationBranch(C, frontier, base.values.length + 1, "offline-b", "Beta");
    const events = [...branchB, ...branchC, ...unrelated(D, frontier, base.values.length + 1)];
    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      const fields = generation.origin.materializedFields.owner;
      expect(fields).toHaveLength(1);
      expect(new Set(fields?.[0]?.valueOccurrenceIds)).toEqual(
        new Set(["offline-a-value-occurrence", "offline-b-value-occurrence"]),
      );
      for (const prefix of ["offline-a", "offline-b"]) {
        expect(generation.origin.nodes[`${prefix}-field`]).toBeDefined();
        expect(
          generation.origin.nodes[`${prefix}-value`]?.content
            .filter((item) => item.kind === "text")
            .map((atom) => atom.value)
            .join(""),
        ).toBe(prefix === "offline-a" ? "Alpha" : "Beta");
      }
    });
  });

  it("preserves divergent concurrent default configs as explicit candidates", () => {
    const base = relationBase(["supertag", "field", "task", "unrelated"]);
    base.add({
      kind: "supertag-field-add",
      supertagId: "supertag",
      fieldDefinitionId: "field",
      fieldNodeId: "supertag-field-template-field",
      fieldOccurrenceId: "supertag-field-template-field-occurrence",
      anchor: end,
    });
    base.add({ kind: "supertag-apply", nodeId: "task", supertagId: "supertag", anchor: end });
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [fieldConfig("Planned", "pinned")]),
      ...remoteBranch(C, frontier, base.values.length + 1, [fieldConfig("Started", "normal")]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      const item = generation.origin.templateFields.supertag?.[0];
      expect(item?.effectiveConfig).toBeNull();
      expect(item?.configCandidates).toHaveLength(2);
      expect(
        Object.values(generation.origin.conflictIssues).filter((issue) => issue.kind === "field-config-conflict"),
      ).toHaveLength(2);
      expect(generation.origin.materializedFields.task).toBeUndefined();
    });
  });
});

function relationBase(nodeIds: readonly string[]): Facts {
  const facts = new Facts();
  for (const nodeId of nodeIds) {
    facts.addPlaced(nodeId);
  }
  for (const nodeId of nodeIds.filter(
    (nodeId) => nodeId.includes("supertag") || nodeId === "derived" || nodeId === "base",
  )) {
    facts.add({ kind: "node-type-declare", nodeId, nodeType: "supertag-definition" });
  }
  for (const nodeId of nodeIds.filter((nodeId) => nodeId === "field")) {
    facts.add({ kind: "node-type-declare", nodeId, nodeType: "field-definition" });
  }
  return facts;
}

function unrelated(replicaId: string, observed: FactFrontier, lamport: number): readonly Fact[] {
  return remoteBranch(replicaId, observed, lamport, [
    {
      kind: "text-splice",
      nodeId: "unrelated",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "unrelated",
    },
  ]);
}

function materializationBase(): Facts {
  const facts = relationBase(["supertag", "field", "owner", "unrelated"]);
  facts.add({
    kind: "supertag-field-add",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",
    fieldOccurrenceId: "supertag-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({ kind: "supertag-apply", nodeId: "owner", supertagId: "supertag", anchor: end });
  return facts;
}

function materializationBranch(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  prefix: string,
  text: string,
): readonly Fact[] {
  return remoteBranch(replicaId, observed, lamport, [
    { kind: "node-create", nodeId: `${prefix}-field` },
    {
      kind: "occurrence-create",
      occurrenceId: `${prefix}-field-occurrence`,
      nodeId: `${prefix}-field`,
      parentNodeId: "owner",
      anchor: end,
    },
    {
      kind: "field-materialize",
      ownerNodeId: "owner",
      fieldDefinitionId: "field",
      fieldNodeId: `${prefix}-field`,
      fieldOccurrenceId: `${prefix}-field-occurrence`,
    },
    { kind: "node-create", nodeId: `${prefix}-value` },
    {
      kind: "occurrence-create",
      occurrenceId: `${prefix}-value-occurrence`,
      nodeId: `${prefix}-value`,
      parentNodeId: `${prefix}-field`,
      anchor: end,
    },
    {
      kind: "text-splice",
      nodeId: `${prefix}-value`,
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: text,
    },
  ]);
}

function fieldConfig(
  value: string,
  visibility: "normal" | "pinned",
): Extract<Mutation, { kind: "supertag-field-configure" }> {
  return {
    kind: "supertag-field-configure",
    supertagId: "supertag",
    fieldDefinitionId: "field",
    fieldNodeId: "supertag-field-template-field",

    config: {
      visibility,
      staticDefault: [{ kind: "text", value }],
    },
    previousConfig: { visibility: "normal", staticDefault: null },
    observedConfigFactIds: [],
  };
}
