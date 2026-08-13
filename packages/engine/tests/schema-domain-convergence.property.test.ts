import { describe, expect, it } from "vitest";

import {
  frontierOf,
  type Fact,
  type FactFrontier,
  type Mutation,
} from "../src/domain/fact/index.js";
import { end, Facts } from "../src/domain/reconcile/reconcile-test-helpers.js";
import { assertSchemaConvergence, remoteBranch } from "./schema-convergence-property-helpers.js";

const B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddddd";
const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;

describe("Schema domain convergence matrix", () => {
  it("preserves concurrent Schema Application observed-remove intent across 32 four-replica topologies", () => {
    const base = relationBase(["schema", "task", "unrelated"]);
    base.add({ kind: "schema-apply", nodeId: "task", schemaId: "schema", anchor: end });
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [
        { kind: "schema-remove", nodeId: "task", schemaId: "schema", previousAnchor: start },
      ]),
      ...remoteBranch(C, frontier, base.values.length + 1, [
        { kind: "schema-apply", nodeId: "task", schemaId: "schema", anchor: end },
      ]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSchemaConvergence(base.values.length, [...base.values, ...events], (generation) => {
      expect(generation.origin.schemaApplications.task).toEqual(["schema"]);
      expect(generation.review.schemaApplications).toEqual(generation.origin.schemaApplications);
    });
  });

  it("preserves concurrent Field Contribution observed-remove intent and effective identity", () => {
    const base = relationBase(["schema", "field", "task", "unrelated"]);
    base.add({
      kind: "schema-field-add",
      schemaId: "schema",
      fieldDefinitionId: "field",
      fieldNodeId: "schema-field-template-field",
      fieldOccurrenceId: "schema-field-template-field-occurrence",
      anchor: end,
    });
    base.add({ kind: "schema-apply", nodeId: "task", schemaId: "schema", anchor: end });
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [
        {
          kind: "schema-field-remove",
          schemaId: "schema",
          fieldDefinitionId: "field",
          fieldNodeId: "schema-field-template-field",
          fieldOccurrenceId: "schema-field-template-field-occurrence",
          previousAnchor: start,
        },
      ]),
      ...remoteBranch(C, frontier, base.values.length + 1, [
        {
          kind: "schema-field-add",
          schemaId: "schema",
          fieldDefinitionId: "field",
          fieldNodeId: "schema-field-template-field",
          fieldOccurrenceId: "schema-field-template-field-occurrence",
          anchor: end,
        },
      ]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSchemaConvergence(base.values.length, [...base.values, ...events], (generation) => {
      expect(generation.origin.schemaFields.schema).toEqual(["field"]);
      expect(
        generation.origin.effectiveFields.task?.map((field) => field.fieldDefinitionId),
      ).toEqual(["field"]);
    });
  });

  it("preserves concurrent Extension observed-remove intent and inherited search closure", () => {
    const base = relationBase(["derived", "base", "field", "task", "unrelated"]);
    base.add({
      kind: "schema-field-add",
      schemaId: "base",
      fieldDefinitionId: "field",
      fieldNodeId: "base-field-template-field",
      fieldOccurrenceId: "base-field-template-field-occurrence",
      anchor: end,
    });
    base.add({
      kind: "schema-extension-add",
      schemaId: "derived",
      baseSchemaId: "base",
      anchor: end,
    });
    base.add({ kind: "schema-apply", nodeId: "task", schemaId: "derived", anchor: end });
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [
        {
          kind: "schema-extension-remove",
          schemaId: "derived",
          baseSchemaId: "base",
          previousAnchor: start,
        },
      ]),
      ...remoteBranch(C, frontier, base.values.length + 1, [
        { kind: "schema-extension-add", schemaId: "derived", baseSchemaId: "base", anchor: end },
      ]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSchemaConvergence(base.values.length, [...base.values, ...events], (generation) => {
      expect(generation.origin.schemaExtensions.derived).toEqual(["base"]);
      expect(generation.origin.schemaSearchMembers.base).toEqual(["base", "derived"]);
      expect(generation.origin.effectiveFields.task?.[0]?.fieldDefinitionId).toBe("field");
    });
  });

  it("merges concurrent authored materializations without losing either value or identity", () => {
    const base = materializationBase();
    const frontier = frontierOf(base.values);
    const branchB = materializationBranch(
      B,
      frontier,
      base.values.length + 1,
      "offline-a",
      "Alpha",
    );
    const branchC = materializationBranch(C, frontier, base.values.length + 1, "offline-b", "Beta");
    const events = [...branchB, ...branchC, ...unrelated(D, frontier, base.values.length + 1)];
    assertSchemaConvergence(base.values.length, [...base.values, ...events], (generation) => {
      const fields = generation.origin.materializedFields.owner;
      expect(fields).toHaveLength(1);
      expect(new Set(fields?.[0]?.valueOccurrenceIds)).toEqual(
        new Set(["offline-a-value-occurrence", "offline-b-value-occurrence"]),
      );
      for (const prefix of ["offline-a", "offline-b"]) {
        expect(generation.origin.nodes[`${prefix}-field`]).toBeDefined();
        expect(
          generation.origin.nodes[`${prefix}-value`]?.text.map((atom) => atom.value).join(""),
        ).toBe(prefix === "offline-a" ? "Alpha" : "Beta");
      }
    });
  });

  it("preserves divergent concurrent default configs as explicit candidates", () => {
    const base = relationBase(["schema", "field", "task", "unrelated"]);
    base.add({
      kind: "schema-field-add",
      schemaId: "schema",
      fieldDefinitionId: "field",
      fieldNodeId: "schema-field-template-field",
      fieldOccurrenceId: "schema-field-template-field-occurrence",
      anchor: end,
    });
    base.add({ kind: "schema-apply", nodeId: "task", schemaId: "schema", anchor: end });
    const frontier = frontierOf(base.values);
    const events = [
      ...remoteBranch(B, frontier, base.values.length + 1, [fieldConfig("Planned", "pinned")]),
      ...remoteBranch(C, frontier, base.values.length + 1, [fieldConfig("Started", "normal")]),
      ...unrelated(D, frontier, base.values.length + 1),
    ];
    assertSchemaConvergence(base.values.length, [...base.values, ...events], (generation) => {
      const item = generation.origin.templateFields.schema?.[0];
      expect(item?.effectiveConfig).toBeNull();
      expect(item?.configCandidates).toHaveLength(2);
      expect(
        Object.values(generation.origin.conflictIssues).filter(
          (issue) => issue.kind === "field-config-conflict",
        ),
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
  const facts = relationBase(["schema", "field", "owner", "unrelated"]);
  facts.add({
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field",
    fieldNodeId: "schema-field-template-field",
    fieldOccurrenceId: "schema-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({ kind: "schema-apply", nodeId: "owner", schemaId: "schema", anchor: end });
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
): Extract<Mutation, { kind: "schema-field-configure" }> {
  return {
    kind: "schema-field-configure",
    schemaId: "schema",
    fieldDefinitionId: "field",
    fieldNodeId: "schema-field-template-field",

    config: {
      visibility,
      staticDefault: [{ kind: "text", value }],
      initializer: null,
    },
    previousConfig: { visibility: "normal", staticDefault: null, initializer: null },
    observedConfigFactIds: [],
  };
}
