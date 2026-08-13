import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import {
  canonicalJson,
  factTransactionId,
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

const versions = { rulesVersion: "proposal-rules-3", schemaVersion: "lode-schema-16" } as const;
const deleteReplica = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const insertReplica = "cccccccccccccccccccccccccc";
const unrelatedReplica = "dddddddddddddddddddddddddd";
const restoreReplica = "eeeeeeeeeeeeeeeeeeeeeeeeee";
const checkpointKey = "field-content-deletion-property";

describe("Field content deletion convergence", () => {
  it("preserves a concurrent new value while deleting only the selected value across 32 topologies", () => {
    const base = fixture();
    const baseSnapshot = admitted(base.values);
    const deletion = remoteDeletion(
      deleteReplica,
      baseSnapshot.frontier,
      {
        kind: "field-value-delete",
        ownerNodeId: "owner",
        fieldDefinitionId: "field-definition",
        valueOccurrenceId: "value-a-occurrence",
        previousParentNodeId: "field-node",
        previousAnchor: {
          after: null,
          before: "value-b-occurrence",
          affinity: "after",
          fallback: "start",
        },
      },
      ["value-a"],
    );
    const insertion = remoteFact(insertReplica, baseSnapshot.frontier, {
      kind: "occurrence-create",
      occurrenceId: "value-c-occurrence",
      nodeId: "value-c",
      parentNodeId: "field-node",
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
    const expectedSnapshot = admitted([...base.values, ...deletion, insertion, unrelated]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);

    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = admitted(
        shuffle([...base.values, insertion, ...deletion, unrelated, ...deletion], seed),
      );
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toBe(expectedSummary);
      expect(full.generation.origin.materializedFields.owner?.[0]?.valueOccurrenceIds).toEqual([
        "value-b-occurrence",
        "value-c-occurrence",
      ]);
      expect(full.generation.origin.occurrences["value-a-occurrence"]).toBeUndefined();
      expect(full.generation.origin.nodes["value-a"]).toBeUndefined();
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
    const deletion = remoteDeletion(
      deleteReplica,
      baseSnapshot.frontier,
      {
        kind: "materialized-field-delete",
        ownerNodeId: "owner",
        fieldDefinitionId: "field-definition",
        fieldNodeId: "field-node",
        fieldOccurrenceId: "field-occurrence",
        previousParentNodeId: "owner",
        previousAnchor: { ...end, fallback: "start" },
      },
      ["value-a", "value-b", "field-node"],
    );
    const insertion = remoteFact(insertReplica, baseSnapshot.frontier, {
      kind: "occurrence-create",
      occurrenceId: "value-c-occurrence",
      nodeId: "value-c",
      parentNodeId: "field-node",
      anchor: end,
    });
    const merged = admitted([...base.values, ...deletion, insertion]);
    const hidden = rebuildGeneration("workspace", merged, versions).generation.origin;
    expect(hidden.materializedFields.owner).toBeUndefined();
    expect(hidden.nodes["field-node"]).toBeUndefined();
    expect(hidden.nodes["value-a"]).toBeUndefined();
    expect(hidden.nodes["value-b"]).toBeUndefined();
    expect(hidden.nodes["value-c"]).toBeDefined();
    expect(merged.facts.some((fact) => fact.id === insertion.id)).toBe(true);
    const occurrenceDeletion = deletion.find(
      (fact) =>
        fact.body.kind === "contribution" && fact.body.mutation.kind === "occurrence-delete",
    );
    const nodeDeletions = new Map(
      deletion.flatMap((fact) =>
        fact.body.kind === "contribution" && fact.body.mutation.kind === "node-delete"
          ? [[fact.body.mutation.nodeId, fact.id] as const]
          : [],
      ),
    );
    if (!occurrenceDeletion) {
      throw new Error("Expected generated Field Occurrence deletion");
    }
    const restoration = remoteTransaction(
      restoreReplica,
      merged.frontier,
      ["field-node", "value-a", "value-b"]
        .map((nodeId): Mutation => {
          const deletionFactId = nodeDeletions.get(nodeId);
          if (!deletionFactId) {
            throw new Error(`Expected ${nodeId} deletion Fact`);
          }
          return { kind: "node-restore", nodeId, deletionFactId };
        })
        .concat({
          kind: "occurrence-restore",
          occurrenceId: "field-occurrence",
          deletionFactId: occurrenceDeletion.id,
          parentNodeId: "owner",
          anchor: end,
        }),
      Math.max(...merged.facts.map((fact) => fact.coordinate.lamport)) + 1,
    );
    const expectedSnapshot = admitted([...base.values, ...deletion, insertion, ...restoration]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);

    for (let seed = 33; seed <= 64; seed += 1) {
      const snapshot = admitted(
        shuffle([...base.values, insertion, ...restoration, ...deletion, insertion], seed),
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
  facts.addPlaced("schema");
  facts.addPlaced("field-definition");
  facts.addPlaced("owner", "workspace", "owner-occurrence");
  facts.addPlaced("field-node", "owner", "field-occurrence");
  facts.addPlaced("value-a", "field-node", "value-a-occurrence");
  facts.addPlaced("value-b", "field-node", "value-b-occurrence");
  facts.addPlaced("value-c", "workspace");
  facts.addPlaced("unrelated", "workspace");
  facts.add({
    kind: "schema-field-add",
    schemaId: "schema",
    fieldDefinitionId: "field-definition",
    fieldNodeId: "schema-field-definition-template-field",
    fieldOccurrenceId: "schema-field-definition-template-field-occurrence",
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
  return facts;
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

function remoteDeletion(
  replicaId: string,
  observed: FactFrontier,
  mutation: Extract<Mutation, { kind: "field-value-delete" | "materialized-field-delete" }>,
  ownedNodeIds: readonly string[],
): readonly Fact[] {
  const occurrenceId =
    mutation.kind === "field-value-delete"
      ? mutation.valueOccurrenceId
      : mutation.fieldOccurrenceId;
  return remoteTransaction(replicaId, observed, [
    mutation,
    {
      kind: "occurrence-delete",
      occurrenceId,
      previousParentNodeId: mutation.previousParentNodeId,
      previousAnchor: mutation.previousAnchor,
    },
    ...ownedNodeIds.map((nodeId): Mutation => ({ kind: "node-delete", nodeId })),
  ]);
}

function remoteTransaction(
  replicaId: string,
  observed: FactFrontier,
  mutations: readonly Mutation[],
  firstLamport = Math.max(...Object.values(observed)) + 1,
): readonly Fact[] {
  const transactionId = factTransactionId("workspace", replicaId, 1);
  return mutations.map((mutation, index) =>
    makeFact({
      workspaceId: "workspace",
      replicaId,
      sequence: index + 1,
      observed: index === 0 ? observed : { ...observed, [replicaId]: index },
      lamport: firstLamport + index,
      transaction: { transactionId, index, size: mutations.length },
      body: {
        kind: "contribution",
        actorId: replicaId,
        intent: "direct",
        mutation,
      },
    }),
  );
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
