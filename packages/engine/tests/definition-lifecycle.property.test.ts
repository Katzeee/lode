import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import {
  DEFAULT_FIELD_TEMPLATE_CONFIG,
  frontierOf,
  makeFact,
  type Fact,
  type FactFrontier,
  type Mutation,
} from "../src/domain/fact/index.js";
import { projectSnapshot } from "./support/reconcile/projection.js";
import { end, Facts, versions } from "./support/reconcile/reconcile-test-helpers.js";

const tombstoneReplica = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const editReplica = "cccccccccccccccccccccccccc";
const restoreReplica = "dddddddddddddddddddddddddd";

describe("Definition lifecycle convergence", () => {
  it("preserves concurrent offline config through tombstone and restores it for every arrival order", () => {
    const base = definitionFixture();
    const frontier = frontierOf(base.values);
    const lamport = base.values.length + 1;
    const tombstone = remoteFact(tombstoneReplica, frontier, lamport, {
      kind: "node-delete",
      nodeId: "status-field",
    });
    const configure = remoteFact(editReplica, frontier, lamport, {
      kind: "schema-field-configure",
      schemaId: "task-schema",
      fieldDefinitionId: "status-field",
      fieldNodeId: "task-schema-status-field-template-field",

      config: {
        visibility: "pinned",
        staticDefault: [{ kind: "text", value: "Planned" }],
        initializer: null,
      },
      previousConfig: DEFAULT_FIELD_TEMPLATE_CONFIG,
      observedConfigFactIds: [],
    });
    const merged = [...base.values, tombstone, configure];
    const mergedFrontier = frontierOf(merged);
    const restore = remoteFact(restoreReplica, mergedFrontier, lamport + 1, {
      kind: "node-restore",
      nodeId: "status-field",
      deletionFactId: tombstone.id,
    });

    for (let seed = 1; seed <= 32; seed += 1) {
      const deleted = admitted(shuffle([...merged, configure], seed));
      const deletedProjection = projectSnapshot("workspace", deleted, "origin", versions);
      expect(deletedProjection.nodeStatuses["status-field"]).toMatchObject({
        state: "deleted",
        deletionFactIds: [tombstone.id],
      });
      expect(deletedProjection.schemaFields["task-schema"]).toEqual(["status-field"]);
      expect(deletedProjection.templateFields["task-schema"]?.[0]?.effectiveConfig).toMatchObject({
        staticDefault: [{ kind: "text", value: "Planned" }],
      });
      expect(deletedProjection.effectiveFields.task).toEqual([]);

      const restored = admitted(shuffle([...merged, restore, tombstone], seed * 17));
      const restoredProjection = projectSnapshot("workspace", restored, "origin", versions);
      expect(restoredProjection.nodeStatuses["status-field"]).toMatchObject({
        state: "active",
        deletionFactIds: [],
      });
      expect(restoredProjection.effectiveFields.task?.[0]).toMatchObject({
        fieldDefinitionId: "status-field",
        effectiveConfig: { staticDefault: [{ kind: "text", value: "Planned" }] },
      });
    }
  });
});

function definitionFixture(): Facts {
  const facts = new Facts();
  for (const nodeId of ["task", "task-schema", "status-field"]) {
    facts.addPlaced(nodeId);
  }
  facts.add({
    kind: "node-type-declare",
    nodeId: "task-schema",
    nodeType: "schema",
  });
  facts.add({
    kind: "node-type-declare",
    nodeId: "status-field",
    nodeType: "field-definition",
  });
  facts.add({
    kind: "schema-field-add",
    schemaId: "task-schema",
    fieldDefinitionId: "status-field",
    fieldNodeId: "task-schema-status-field-template-field",
    fieldOccurrenceId: "task-schema-status-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({ kind: "schema-apply", nodeId: "task", schemaId: "task-schema", anchor: end });
  return facts;
}

function remoteFact(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  mutation: Mutation,
): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence: 1,
    observed,
    lamport,
    body: { kind: "contribution", actorId: replicaId, intent: "direct", mutation },
  });
}

function admitted(facts: readonly Fact[]) {
  const admission = admitAuthorityRecords(
    "workspace",
    facts.map((fact) => ({ recordKind: "fact" as const, fact })),
  );
  if (admission.kind === "fault") {
    throw new Error(admission.fault ?? "Definition lifecycle admission failed");
  }
  return admission.snapshot;
}

function shuffle(values: Fact[], seed: number): Fact[] {
  let state = seed >>> 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const selected = state % (index + 1);
    const current = values[index];
    const replacement = values[selected];
    if (!current || !replacement) {
      throw new Error("Shuffle selected an absent Fact");
    }
    values[index] = replacement;
    values[selected] = current;
  }
  return values;
}
