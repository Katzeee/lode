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
import {
  advanceGeneration,
  rebuildGeneration,
  CURRENT_PROJECTION_VERSIONS as versions,
} from "../src/domain/reconcile/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";

const deleteReplica = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const insertReplica = "cccccccccccccccccccccccccc";
const unrelatedReplica = "dddddddddddddddddddddddddd";
const restoreReplica = "eeeeeeeeeeeeeeeeeeeeeeeeee";

describe("Field content deletion convergence", () => {
  it("converges concurrent same-Field value reorders across 32 arrival and incremental topologies", () => {
    const base = orderingFixture();
    const baseSnapshot = admitted(base.values);
    const moveC = remoteFact(insertReplica, baseSnapshot.frontier, {
      kind: "occurrence-move",
      occurrenceId: "value-c-occurrence",
      parentNodeId: "field-node",
      anchor: {
        after: "field-definition-endpoint-occ:v1:field-occurrence",
        before: "value-a-occurrence",
        affinity: "before",
        fallback: "start",
      },
      previousParentNodeId: "field-node",
      previousAnchor: { after: "value-b-occurrence", before: null, affinity: "after", fallback: "end" },
    });
    const moveB = remoteFact(unrelatedReplica, baseSnapshot.frontier, {
      kind: "occurrence-move",
      occurrenceId: "value-b-occurrence",
      parentNodeId: "field-node",
      anchor: {
        after: "field-definition-endpoint-occ:v1:field-occurrence",
        before: "value-a-occurrence",
        affinity: "before",
        fallback: "start",
      },
      previousParentNodeId: "field-node",
      previousAnchor: {
        after: "value-a-occurrence",
        before: "value-c-occurrence",
        affinity: "after",
        fallback: "end",
      },
    });
    const expectedSnapshot = admitted([...base.values, moveC, moveB]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);
    const expectedOrder = expected.origin.materializedFields.owner?.[0]?.valueOccurrenceIds;
    expect(new Set(expectedOrder)).toEqual(new Set(["value-a-occurrence", "value-b-occurrence", "value-c-occurrence"]));

    for (let seed = 65; seed <= 96; seed += 1) {
      const snapshot = admitted(shuffle([...base.values, moveB, moveC, moveB, moveC], seed));
      expect(summary(rebuildGeneration("workspace", snapshot, versions))).toBe(expectedSummary);
    }

    const before = rebuildGeneration("workspace", baseSnapshot, versions);
    expect(summary(advanceGeneration("workspace", baseSnapshot, expectedSnapshot, versions, before))).toBe(
      expectedSummary,
    );
  });

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
          after: "field-definition-endpoint-occ:v1:field-occurrence",
          before: "value-b-occurrence",
          affinity: "after",
          fallback: "end",
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
      const snapshot = admitted(shuffle([...base.values, insertion, ...deletion, unrelated, ...deletion], seed));
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toBe(expectedSummary);
      expect(full.origin.materializedFields.owner?.[0]?.valueOccurrenceIds).toEqual([
        "value-b-occurrence",
        "value-c-occurrence",
      ]);
      expect(full.origin.occurrences["value-a-occurrence"]?.parentNodeId).toBe("workspace-trash:v1:workspace");
      expect(full.origin.nodes["value-a"]).toBeDefined();
      expect(full.review).toEqual({ ...full.origin, perspective: "review" });
    }

    const before = rebuildGeneration("workspace", baseSnapshot, versions);
    expect(summary(advanceGeneration("workspace", baseSnapshot, expectedSnapshot, versions, before))).toBe(
      expectedSummary,
    );
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
    const hidden = rebuildGeneration("workspace", merged, versions).origin;
    expect(hidden.materializedFields.owner).toBeUndefined();
    expect(hidden.nodes["field-node"]).toBeDefined();
    expect(hidden.nodes["value-a"]).toBeDefined();
    expect(hidden.nodes["value-b"]).toBeDefined();
    expect(hidden.nodes["value-c"]).toBeDefined();
    expect(merged.facts.some((fact) => fact.id === insertion.id)).toBe(true);
    const nodeDeletions = new Map(
      deletion.flatMap((fact) =>
        fact.body.kind === "contribution" && fact.body.mutation.kind === "node-delete"
          ? [[fact.body.mutation.nodeId, fact.id] as const]
          : [],
      ),
    );
    const fieldDeletionFactId = nodeDeletions.get("field-node");
    if (!fieldDeletionFactId) {
      throw new Error("Expected structural Field Node deletion");
    }
    const restoration = remoteTransaction(
      restoreReplica,
      merged.frontier,
      [
        { kind: "node-restore", nodeId: "field-node", deletionFactId: fieldDeletionFactId },
        {
          kind: "node-owner-set",
          nodeId: "field-node",
          ownerNodeId: "owner",
          previousOwnerNodeId: "workspace-trash:v1:workspace",
        },
        {
          kind: "occurrence-move",
          occurrenceId: "field-occurrence",
          parentNodeId: "owner",
          anchor: { ...end, fallback: "start" },
          previousParentNodeId: "workspace-trash:v1:workspace",
          previousAnchor: { ...end, fallback: "start" },
        },
      ],
      Math.max(...merged.facts.map((fact) => fact.coordinate.lamport)) + 1,
    );
    const expectedSnapshot = admitted([...base.values, ...deletion, insertion, ...restoration]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);

    for (let seed = 33; seed <= 64; seed += 1) {
      const snapshot = admitted(shuffle([...base.values, insertion, ...restoration, ...deletion, insertion], seed));
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toBe(expectedSummary);
      expect(full.origin.materializedFields.owner?.[0]?.valueOccurrenceIds).toEqual([
        "value-a-occurrence",
        "value-b-occurrence",
        "value-c-occurrence",
      ]);
      expect(full.origin.nodes["value-a"]).toBeDefined();
      expect(full.origin.nodes["value-b"]).toBeDefined();
      expect(full.origin.nodes["value-c"]).toBeDefined();
    }

    const before = rebuildGeneration("workspace", baseSnapshot, versions);
    expect(summary(advanceGeneration("workspace", baseSnapshot, expectedSnapshot, versions, before))).toBe(
      expectedSummary,
    );
  });
});

function fixture(): Facts {
  const facts = new Facts();
  facts.addPlaced("field-definition");
  facts.add({
    kind: "intrinsic-node-type-declare",
    nodeId: "field-definition",
    intrinsicNodeType: "field-definition",
  });
  facts.addPlaced("owner", "workspace", "owner-occurrence");
  facts.addPlaced("field-node", "owner", "field-occurrence");
  facts.addPlaced("value-a", "field-node", "value-a-occurrence");
  facts.addPlaced("value-b", "field-node", "value-b-occurrence");
  facts.addPlaced("value-c", "workspace");
  facts.addPlaced("unrelated", "workspace");
  facts.add({
    kind: "field-materialize",
    ownerNodeId: "owner",
    fieldDefinitionId: "field-definition",
    fieldNodeId: "field-node",
    fieldOccurrenceId: "field-occurrence",
  });
  return facts;
}

function orderingFixture(): Facts {
  const facts = new Facts();
  facts.addPlaced("field-definition");
  facts.add({
    kind: "intrinsic-node-type-declare",
    nodeId: "field-definition",
    intrinsicNodeType: "field-definition",
  });
  facts.addPlaced("owner", "workspace", "owner-occurrence");
  facts.addPlaced("field-node", "owner", "field-occurrence");
  facts.addPlaced("value-a", "field-node", "value-a-occurrence");
  facts.addPlaced("value-b", "field-node", "value-b-occurrence");
  facts.addPlaced("value-c", "field-node", "value-c-occurrence");
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
  const rootNodeId = ownedNodeIds.at(-1);
  if (!rootNodeId) {
    throw new Error("Field content deletion fixture requires a structural root");
  }
  const ownerNodeId = mutation.kind === "field-value-delete" ? mutation.previousParentNodeId : mutation.ownerNodeId;
  const occurrenceId = mutation.kind === "field-value-delete" ? mutation.valueOccurrenceId : mutation.fieldOccurrenceId;
  if (!ownerNodeId) {
    throw new Error("Field content deletion fixture has no root Owner");
  }
  return remoteTransaction(replicaId, observed, [
    mutation,
    { kind: "node-delete", nodeId: rootNodeId },
    {
      kind: "node-owner-set",
      nodeId: rootNodeId,
      ownerNodeId: "workspace-trash:v1:workspace",
      previousOwnerNodeId: ownerNodeId,
    },
    {
      kind: "occurrence-move",
      occurrenceId,
      parentNodeId: "workspace-trash:v1:workspace",
      anchor: end,
      previousParentNodeId: ownerNodeId,
      previousAnchor: mutation.previousAnchor,
    },
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
  return canonicalJson(result);
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
