import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import {
  DEFAULT_SUPERTAG_FIELD_CONFIG,
  frontierOf,
  makeFact,
  type Fact,
  type FactFrontier,
  type Mutation,
  workspaceTrashNodeId,
} from "../src/domain/fact/index.js";
import { projectSnapshot } from "./support/reconcile/projection.js";
import { end, Facts, versions } from "./support/reconcile/reconcile-test-helpers.js";

const deletionReplica = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const editReplica = "cccccccccccccccccccccccccc";
const restoreReplica = "dddddddddddddddddddddddddd";

describe("Definition lifecycle convergence", () => {
  it("preserves concurrent offline config while the Definition is in Trash and restores it for every arrival order", () => {
    const base = definitionFixture();
    const frontier = frontierOf(base.values);
    const lamport = base.values.length + 1;
    const deletion = remoteFact(deletionReplica, frontier, lamport, {
      kind: "node-delete",
      nodeId: "status-field",
    });
    const configure = remoteFact(editReplica, frontier, lamport, {
      kind: "supertag-field-configure",
      supertagId: "task-supertag",
      fieldDefinitionId: "status-field",
      fieldNodeId: "task-supertag-status-field-template-field",

      config: {
        visibility: "pinned",
        staticDefault: [{ kind: "text", value: "Planned" }],
      },
      previousConfig: DEFAULT_SUPERTAG_FIELD_CONFIG,
      observedConfigFactIds: [],
    });
    const merged = [...base.values, deletion, configure];
    const mergedFrontier = frontierOf(merged);
    const restore = remoteFact(restoreReplica, mergedFrontier, lamport + 1, {
      kind: "node-restore",
      nodeId: "status-field",
      deletionFactId: deletion.id,
    });

    for (let seed = 1; seed <= 32; seed += 1) {
      const deleted = admitted(shuffle([...merged, configure], seed));
      const deletedProjection = projectSnapshot("workspace", deleted, "origin", versions);
      expect(deletedProjection.nodeOwners["status-field"]).toBe(workspaceTrashNodeId("workspace"));
      expect(deletedProjection.supertagFields["task-supertag"]).toEqual(["status-field"]);
      expect(deletedProjection.templateFields["task-supertag"]?.[0]?.effectiveConfig).toMatchObject({
        staticDefault: [{ kind: "text", value: "Planned" }],
      });
      expect(deletedProjection.effectiveFields.task).toEqual([]);

      const restored = admitted(shuffle([...merged, restore, deletion], seed * 17));
      const restoredProjection = projectSnapshot("workspace", restored, "origin", versions);
      expect(restoredProjection.nodeOwners["status-field"]).not.toBe(workspaceTrashNodeId("workspace"));
      expect(restoredProjection.effectiveFields.task?.[0]).toMatchObject({
        fieldDefinitionId: "status-field",
        effectiveConfig: { staticDefault: [{ kind: "text", value: "Planned" }] },
      });
    }
  });
});

function definitionFixture(): Facts {
  const facts = new Facts();
  for (const nodeId of ["task", "task-supertag", "status-field"]) {
    facts.addPlaced(nodeId);
  }
  facts.add({
    kind: "node-type-declare",
    nodeId: "task-supertag",
    nodeType: "supertag-definition",
  });
  facts.add({
    kind: "node-type-declare",
    nodeId: "status-field",
    nodeType: "field-definition",
  });
  facts.add({
    kind: "supertag-field-add",
    supertagId: "task-supertag",
    fieldDefinitionId: "status-field",
    fieldNodeId: "task-supertag-status-field-template-field",
    fieldOccurrenceId: "task-supertag-status-field-template-field-occurrence",
    anchor: end,
  });
  facts.add({ kind: "supertag-apply", nodeId: "task", supertagId: "task-supertag", anchor: end });
  return facts;
}

function remoteFact(replicaId: string, observed: FactFrontier, lamport: number, mutation: Mutation): Fact {
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
