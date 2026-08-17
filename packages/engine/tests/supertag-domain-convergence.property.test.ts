import { describe, expect, it } from "vitest";

import { frontierOf, type Fact, type FactFrontier, type Mutation, type TextAtomId } from "../src/domain/fact/index.js";
import { textAtoms } from "../src/domain/reconcile/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import {
  supertagApplicationIdentity,
  supertagApplicationMutations,
  supertagRemovalMutations,
} from "./support/reconcile/supertag-application-test-helpers.js";
import { assertSupertagConvergence, remoteBranch } from "./supertag-convergence-property-helpers.js";

const B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddddd";
const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;
const occurrenceStart = { after: null, before: null, affinity: "after", fallback: "start" } as const;

describe("Supertag domain convergence matrix", () => {
  it("preserves concurrent Supertag Application observed-remove intent across 32 four-replica topologies", () => {
    const base = relationBase(["supertag", "task", "unrelated"]);
    base.applySupertag("task", "supertag");
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(
        B,
        frontier,
        base.values.length + 1,
        supertagRemovalMutations(supertagApplicationIdentity("task", "supertag"), start, occurrenceStart),
      ),
      ...remoteBranch(
        C,
        frontier,
        base.values.length + 1,
        supertagApplicationMutations(supertagApplicationIdentity("task", "supertag", 2), end, false),
      ),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      expect(generation.origin.supertagApplications.task?.map(({ supertagId }) => supertagId)).toEqual(["supertag"]);
      expect(generation.review.supertagApplications).toEqual(generation.origin.supertagApplications);
    });
  });

  it("preserves concurrent Extension observed-remove intent", () => {
    const base = relationBase(["derived", "base", "task", "unrelated"]);
    attachOwnedTemplateField(base, "base");
    base.add({ kind: "supertag-extension-add", supertagId: "derived", baseSupertagId: "base", anchor: end });
    base.applySupertag("task", "derived");
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [
        { kind: "supertag-extension-remove", supertagId: "derived", baseSupertagId: "base", previousAnchor: start },
      ]),
      ...remoteBranch(C, frontier, base.values.length + 1, [
        { kind: "supertag-extension-add", supertagId: "derived", baseSupertagId: "base", anchor: end },
      ]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      expect(generation.origin.supertagExtensions.derived).toEqual(["base"]);
      expect(generation.origin.supertagInstanceSupertags.base).toEqual(["base", "derived"]);
      expect(generation.origin.effectiveFields.task).toEqual([
        expect.objectContaining({
          fieldDefinitionId: "field-definition",
          sources: [
            expect.objectContaining({
              applicationNodeId: "task-derived-application-1",
              sourceSupertagId: "base",
              extensionPath: ["derived", "base"],
              templateFieldNodeId: "template-field",
            }),
          ],
        }),
      ]);
    });
  });

  it("merges concurrent authored materializations without losing either value or identity", () => {
    const base = materializationBase();
    const frontier = frontierOf(base.values);
    const events = [
      ...materializationBranch(B, frontier, base.values.length + 1, "offline-a", "Alpha"),
      ...materializationBranch(C, frontier, base.values.length + 1, "offline-b", "Beta"),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      const fields = generation.origin.materializedFields.owner;
      expect(fields).toHaveLength(1);
      expect(new Set(fields?.[0]?.valueOccurrenceIds)).toEqual(
        new Set(["offline-a-value-occurrence", "offline-b-value-occurrence"]),
      );
    });
  });

  it("preserves concurrent Static Default text authorship across 32 three-replica topologies", () => {
    const { facts: base, baseline } = staticDefaultBase();
    const frontier = frontierOf(base.values);
    const deletedAtoms = [..."Alpha"].map(
      (value, index): { id: TextAtomId; value: string; attributes: Record<string, never> } => ({
        id: `${baseline.id}#${index}`,
        value,
        attributes: {},
      }),
    );
    const replacement = (insert: string): Mutation => ({
      kind: "text-splice",
      nodeId: "static-default",
      deleteAtomIds: deletedAtoms.map((atom) => atom.id),
      deletedAtoms,
      anchor: end,
      insert,
    });
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [replacement("Beta")]),
      ...remoteBranch(C, frontier, base.values.length + 1, [replacement("Gamma")]),
    ];

    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      const value = textAtoms(generation.origin.nodes["static-default"])
        .map((atom) => atom.value)
        .join("");
      expect(value).not.toContain("Alpha");
      expect(value).toContain("Beta");
      expect(value).toContain("Gamma");
      expect(generation.origin.templateFields.supertag?.[0]).toMatchObject({
        templateFieldNodeId: "template-field",
        fieldDefinitionId: "field-definition",
        staticDefaultValueNodeId: "static-default",
      });
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
    facts.add({ kind: "intrinsic-node-type-declare", nodeId, intrinsicNodeType: "supertag-definition" });
  }
  if (nodeIds.includes("field")) {
    facts.add({ kind: "intrinsic-node-type-declare", nodeId: "field", intrinsicNodeType: "field-definition" });
  }
  return facts;
}

function unrelated(replicaId: string, observed: FactFrontier, lamport: number): readonly Fact[] {
  return remoteBranch(replicaId, observed, lamport, [
    { kind: "text-splice", nodeId: "unrelated", deleteAtomIds: [], deletedAtoms: [], anchor: end, insert: "unrelated" },
  ]);
}

function materializationBase(): Facts {
  return relationBase(["field", "owner", "unrelated"]);
}

function staticDefaultBase(): { facts: Facts; baseline: Fact } {
  const facts = relationBase(["supertag", "unrelated"]);
  attachOwnedTemplateField(facts, "supertag");
  const baseline = facts.add({
    kind: "text-splice",
    nodeId: "static-default",
    deleteAtomIds: [],
    deletedAtoms: [],
    anchor: end,
    insert: "Alpha",
  });
  return { facts, baseline };
}

function attachOwnedTemplateField(facts: Facts, supertagId: string): void {
  facts.addTransaction([
    { kind: "node-create", nodeId: "template-field" },
    {
      kind: "node-owner-set",
      nodeId: "template-field",
      ownerNodeId: supertagId,
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId: "template-field-occurrence",
      nodeId: "template-field",
      parentNodeId: supertagId,
      anchor: end,
    },
    { kind: "intrinsic-node-type-declare", nodeId: "template-field", intrinsicNodeType: "field" },
    { kind: "node-create", nodeId: "field-definition" },
    {
      kind: "node-owner-set",
      nodeId: "field-definition",
      ownerNodeId: "template-field",
      previousOwnerNodeId: null,
    },
    {
      kind: "intrinsic-node-type-declare",
      nodeId: "field-definition",
      intrinsicNodeType: "field-definition",
    },
    {
      kind: "occurrence-create",
      occurrenceId: "field-definition-occurrence",
      nodeId: "field-definition",
      parentNodeId: "template-field",
      anchor: end,
    },
    { kind: "node-create", nodeId: "static-default" },
    {
      kind: "node-owner-set",
      nodeId: "static-default",
      ownerNodeId: "template-field",
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId: "static-default-occurrence",
      nodeId: "static-default",
      parentNodeId: "template-field",
      anchor: {
        after: "field-definition-occurrence",
        before: null,
        affinity: "after",
        fallback: "end",
      },
    },
    {
      kind: "supertag-template-field-attach",
      supertagId,
      templateFieldNodeId: "template-field",
      templateFieldOccurrenceId: "template-field-occurrence",
      fieldDefinitionId: "field-definition",
      definitionOccurrenceId: "field-definition-occurrence",
      staticDefaultValueNodeId: "static-default",
      staticDefaultValueOccurrenceId: "static-default-occurrence",
      anchor: end,
    },
  ]);
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
    { kind: "intrinsic-node-type-declare", nodeId: `${prefix}-field`, intrinsicNodeType: "field" },
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
    { kind: "text-splice", nodeId: `${prefix}-value`, deleteAtomIds: [], deletedAtoms: [], anchor: end, insert: text },
  ]);
}
