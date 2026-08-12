import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import {
  canonicalJson,
  makeFact,
  type Fact,
  type FactFrontier,
  type Mutation,
} from "../src/domain/fact/index.js";
import { advanceGeneration, rebuildGeneration } from "../src/domain/reconcile/index.js";
import { end, Facts } from "../src/domain/reconcile/reconcile-test-helpers.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/workspace/generation-checkpoint.js";

const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;
const deleteReplica = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const insertReplica = "cccccccccccccccccccccccccc";
const unrelatedReplica = "dddddddddddddddddddddddddd";
const restoreReplica = "eeeeeeeeeeeeeeeeeeeeeeeeee";
const checkpointKey = "field-content-deletion-property";

describe("Field content deletion convergence", () => {
  it("preserves a concurrent new value while deleting only the selected value across 32 topologies", () => {
    const base = fixture();
    const baseSnapshot = admitted(base.values);
    const deletion = remoteFact(deleteReplica, baseSnapshot.frontier, {
      kind: "field-value-delete",
      ownerNodeId: "owner",
      fieldDefinitionId: "field-definition",
      valueOccurrenceId: "value-a-occurrence",
      previousParentOccurrenceId: "field-occurrence",
      previousAnchor: {
        after: null,
        before: "value-b-occurrence",
        affinity: "after",
        fallback: "start",
      },
    });
    const insertion = remoteFact(insertReplica, baseSnapshot.frontier, {
      kind: "occurrence-create",
      occurrenceId: "value-c-occurrence",
      nodeId: "value-c",
      parentOccurrenceId: "field-occurrence",
      parentPolicy: "cascade",
      anchor: end,
    });
    const unrelated = remoteFact(unrelatedReplica, baseSnapshot.frontier, {
      kind: "text-splice",
      nodeId: "unrelated",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "independent",
    });
    const expectedSnapshot = admitted([...base.values, deletion, insertion, unrelated]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);

    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = admitted(
        shuffle([...base.values, insertion, deletion, unrelated, deletion], seed),
      );
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toBe(expectedSummary);
      expect(full.generation.origin.materializedFields.owner?.[0]?.valueOccurrenceIds).toEqual([
        "value-b-occurrence",
        "value-c-occurrence",
      ]);
      expect(full.generation.origin.occurrences["value-a-occurrence"]).toBeUndefined();
      expect(full.generation.origin.nodes["value-a"]).toBeDefined();
      expect(full.generation.review).toEqual({ ...full.generation.origin, view: "review" });
    }

    const before = rebuildGeneration("workspace", baseSnapshot, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", baseSnapshot, before, checkpointKey);
    expect(
      summary(advanceGeneration("workspace", baseSnapshot, expectedSnapshot, versions, before)),
    ).toBe(expectedSummary);
    expect(
      summary(
        reconcileFromCheckpoint(checkpoint, "workspace", expectedSnapshot, versions, checkpointKey),
      ),
    ).toBe(expectedSummary);
  });

  it("restores the full Field subtree including a concurrently authored value", () => {
    const base = fixture();
    const baseSnapshot = admitted(base.values);
    const deletion = remoteFact(deleteReplica, baseSnapshot.frontier, {
      kind: "materialized-field-delete",
      ownerNodeId: "owner",
      fieldDefinitionId: "field-definition",
      fieldNodeId: "field-node",
      fieldOccurrenceId: "field-occurrence",
      previousParentOccurrenceId: "owner-occurrence",
      previousAnchor: { ...end, fallback: "start" },
    });
    const insertion = remoteFact(insertReplica, baseSnapshot.frontier, {
      kind: "occurrence-create",
      occurrenceId: "value-c-occurrence",
      nodeId: "value-c",
      parentOccurrenceId: "field-occurrence",
      parentPolicy: "cascade",
      anchor: end,
    });
    const merged = admitted([...base.values, deletion, insertion]);
    const hidden = rebuildGeneration("workspace", merged, versions).generation.origin;
    expect(hidden.materializedFields.owner).toBeUndefined();
    expect(hidden.nodes["field-node"]).toBeDefined();
    expect(hidden.nodes["value-c"]).toBeDefined();
    expect(merged.facts.some((fact) => fact.id === insertion.id)).toBe(true);
    const restoration = remoteFact(
      restoreReplica,
      merged.frontier,
      {
        kind: "occurrence-restore",
        occurrenceId: "field-occurrence",
        deletionFactId: deletion.id,
        parentOccurrenceId: "owner-occurrence",
        anchor: end,
      },
      Math.max(...merged.facts.map((fact) => fact.coordinate.lamport)) + 1,
    );
    const expectedSnapshot = admitted([...base.values, deletion, insertion, restoration]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);

    for (let seed = 33; seed <= 64; seed += 1) {
      const snapshot = admitted(
        shuffle([...base.values, insertion, restoration, deletion, insertion], seed),
      );
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toBe(expectedSummary);
      expect(full.generation.origin.materializedFields.owner?.[0]?.valueOccurrenceIds).toEqual([
        "value-a-occurrence",
        "value-b-occurrence",
        "value-c-occurrence",
      ]);
      expect(full.generation.origin.nodes["value-a"]).toBeDefined();
      expect(full.generation.origin.nodes["value-b"]).toBeDefined();
      expect(full.generation.origin.nodes["value-c"]).toBeDefined();
    }

    const before = rebuildGeneration("workspace", baseSnapshot, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", baseSnapshot, before, checkpointKey);
    expect(
      summary(advanceGeneration("workspace", baseSnapshot, expectedSnapshot, versions, before)),
    ).toBe(expectedSummary);
    expect(
      summary(
        reconcileFromCheckpoint(checkpoint, "workspace", expectedSnapshot, versions, checkpointKey),
      ),
    ).toBe(expectedSummary);
  });
});

function fixture(): Facts {
  const facts = new Facts();
  for (const nodeId of [
    "schema",
    "field-definition",
    "owner",
    "field-node",
    "value-a",
    "value-b",
    "value-c",
    "unrelated",
  ]) {
    facts.add({ kind: "node-create", nodeId });
  }
  facts.add(occurrence("owner-occurrence", "owner", null));
  facts.add(occurrence("field-occurrence", "field-node", "owner-occurrence"));
  facts.add({
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field-definition",
    anchor: end,
  });
  facts.add({ kind: "schema-apply", nodeId: "owner", schemaId: "schema", anchor: end });
  facts.add({
    kind: "field-materialize",
    ownerNodeId: "owner",
    fieldDefinitionId: "field-definition",
    fieldNodeId: "field-node",
    fieldOccurrenceId: "field-occurrence",
  });
  facts.add(occurrence("value-a-occurrence", "value-a", "field-occurrence"));
  facts.add(occurrence("value-b-occurrence", "value-b", "field-occurrence"));
  return facts;
}

function occurrence(
  occurrenceId: string,
  nodeId: string,
  parentOccurrenceId: string | null,
): Mutation {
  return {
    kind: "occurrence-create",
    occurrenceId,
    nodeId,
    parentOccurrenceId,
    parentPolicy: "cascade",
    anchor: end,
  };
}

function remoteFact(
  replicaId: string,
  observed: FactFrontier,
  mutation: Mutation,
  lamport = Math.max(...Object.values(observed)) + 1,
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
    throw new Error(admission.fault ?? "Field content deletion fixture admission failed");
  }
  return admission.snapshot;
}

function summary(result: ReturnType<typeof rebuildGeneration> | null): string {
  if (!result) {
    throw new Error("Expected Field content deletion Reconcile result");
  }
  return canonicalJson(result.generation);
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
