import { describe, expect, it } from "vitest";

import {
  frontierOf,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  type Fact,
  type FactFrontier,
} from "../src/domain/fact/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import { addDefinitionNode, addPlacedNode } from "./support/reconcile/placed-node-test-helpers.js";
import {
  supertagApplicationActions,
  supertagRemovalActions,
} from "./support/reconcile/supertag-application-test-helpers.js";
import { assertSupertagConvergence, remoteBranch } from "./supertag-convergence-property-helpers.js";

const B = "202";
const C = "303";
const D = "404";

describe("Supertag domain convergence matrix", () => {
  it("preserves concurrent Supertag Application observed-remove intent across 32 four-replica topologies", () => {
    const base = relationBase(["supertag", "task", "unrelated"]);
    base.applySupertag("task", "supertag");
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, supertagRemovalActions("task", "supertag")),
      ...remoteBranch(C, frontier, base.values.length + 1, supertagApplicationActions("task", "supertag", end)),
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
        { kind: "supertag-extension-remove", supertagId: "derived", baseSupertagId: "base" },
      ]),
      ...remoteBranch(C, frontier, base.values.length + 1, [
        { kind: "supertag-extension-add", supertagId: "derived", baseSupertagId: "base", anchor: end },
      ]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSupertagConvergence(base.values.length, [...base.values, ...events], (generation) => {
      expect(generation.origin.supertagExtensions.derived).toEqual(["base"]);
      expect(generation.origin.supertagInstanceSupertags.base).toEqual(["base", "derived"]);
      const applicationNodeId = generation.origin.effectiveFields.task?.[0]?.sources[0]?.applicationNodeId;
      if (typeof applicationNodeId !== "string") {
        throw new Error("Expected Effective Field provenance to identify its Supertag Application");
      }
      expect(generation.origin.effectiveFields.task).toEqual([
        expect.objectContaining({
          fieldDefinitionId: "field-definition",
          sources: [
            expect.objectContaining({
              applicationNodeId,
              sourceSupertagId: "base",
              extensionPath: ["derived", "base"],
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
      expect(fields?.[0]).toMatchObject({
        fieldNodeId: materializedFieldNodeId("owner", "field"),
        fieldOccurrenceId: materializedFieldOccurrenceId("owner", "field"),
      });
      expect(new Set(fields?.[0]?.valueOccurrenceIds)).toEqual(
        new Set(["offline-a-value-occurrence", "offline-b-value-occurrence"]),
      );
    });
  });
});

function relationBase(nodeIds: readonly string[]): Facts {
  const facts = new Facts();
  for (const nodeId of nodeIds) {
    if (nodeId.includes("supertag") || nodeId === "derived" || nodeId === "base") {
      addDefinitionNode(facts, nodeId, "supertag-definition");
    } else if (nodeId === "field") {
      addDefinitionNode(facts, nodeId, "field-definition");
    } else {
      addPlacedNode(facts, nodeId);
    }
  }
  return facts;
}

function unrelated(replicaId: string, observed: FactFrontier, lamport: number): readonly Fact[] {
  return remoteBranch(replicaId, observed, lamport, [
    { kind: "rich-text-splice", nodeId: "unrelated", deleteAtomIds: [], anchor: end, insert: "unrelated" },
  ]);
}

function materializationBase(): Facts {
  return relationBase(["field", "owner", "unrelated"]);
}

function attachOwnedTemplateField(facts: Facts, supertagId: string): void {
  facts.add({
    kind: "template-field-add",
    supertagId,
    fieldDefinition: { kind: "new", fieldDefinitionId: "field-definition" },
    anchor: end,
  });
}

function materializationBranch(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  prefix: string,
  text: string,
): readonly Fact[] {
  const fieldNodeId = materializedFieldNodeId("owner", "field");
  const fieldOccurrenceId = materializedFieldOccurrenceId("owner", "field");
  return remoteBranch(replicaId, observed, lamport, [
    {
      kind: "node-create",
      nodeId: fieldNodeId,
      ownerNodeId: "owner",
      originalPlacement: { placementId: fieldOccurrenceId, anchor: end },
      intrinsicNodeType: "field",
    },
    {
      kind: "field-materialize",
      ownerNodeId: "owner",
      fieldDefinitionId: "field",
    },
    {
      kind: "node-create",
      nodeId: `${prefix}-value`,
      ownerNodeId: fieldNodeId,
      originalPlacement: { placementId: `${prefix}-value-occurrence`, anchor: end },
    },
    { kind: "rich-text-splice", nodeId: `${prefix}-value`, deleteAtomIds: [], anchor: end, insert: text },
  ]);
}
