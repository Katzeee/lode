import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import {
  canonicalJson,
  factTransactionId,
  makeFact,
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  type Fact,
  type FactFrontier,
  type Mutation,
} from "../src/domain/fact/index.js";
import {
  advanceGeneration,
  rebuildGeneration,
  textAtoms,
  CURRENT_PROJECTION_VERSIONS as versions,
} from "../src/domain/reconcile/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/materialization/generation-checkpoint.js";

const removeReplica = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const addReplica = "cccccccccccccccccccccccccc";
const detachReplica = "dddddddddddddddddddddddddd";
const checkpointKey = "template-node-property";

describe("Template Node convergence", () => {
  it("preserves concurrent observed-remove support and detached content across 32 arrival topologies", () => {
    const base = fixture();
    const baseSnapshot = admitted(base.values);
    const frontier = baseSnapshot.frontier;
    const [remove, removePlacement] = remoteFacts(removeReplica, frontier, base.values.length + 1, [
      {
        kind: "supertag-template-node-remove",
        supertagId: "supertag",
        templateNodeId: "guidance",
        templateOccurrenceId: "supertag-guidance-template-occurrence",
        previousAnchor: { after: null, before: null, affinity: "before", fallback: "start" },
      },
      {
        kind: "occurrence-delete",
        occurrenceId: "supertag-guidance-template-occurrence",
        previousParentNodeId: "supertag",
        previousAnchor: { after: null, before: null, affinity: "after", fallback: "start" },
      },
    ]);
    const add = remoteFact(addReplica, frontier, base.values.length + 1, {
      kind: "supertag-template-node-add",
      supertagId: "supertag",
      templateNodeId: "guidance",
      templateOccurrenceId: "supertag-guidance-template-occurrence",
      anchor: end,
    });
    const merged = admitted([...base.values, remove, removePlacement, add]);
    const [detachedNode, detachedOwner, detach, detachedOccurrence] = remoteFacts(
      detachReplica,
      merged.frontier,
      Math.max(...merged.facts.map((fact) => fact.coordinate.lamport)) + 1,
      [
        {
          kind: "node-create",
          nodeId: templateInstanceNodeId("note", "guidance"),
          seed: {
            text: [..."Guidance"].map((value) => ({ value, attributes: {} })),
          },
        },
        {
          kind: "node-owner-set",
          nodeId: templateInstanceNodeId("note", "guidance"),
          ownerNodeId: "note",
          previousOwnerNodeId: null,
        },
        {
          kind: "template-node-detach",
          ownerNodeId: "note",
          templateNodeId: "guidance",
          instanceNodeId: templateInstanceNodeId("note", "guidance"),
          instanceOccurrenceId: templateInstanceOccurrenceId("note", "guidance"),
          anchor: end,
          sourceSupertagIds: ["supertag"],
          sourceApplicationSupertagIds: ["supertag"],
          sourceTemplateOccurrenceIds: ["supertag-guidance-template-occurrence"],
        },
        {
          kind: "occurrence-create",
          occurrenceId: templateInstanceOccurrenceId("note", "guidance"),
          nodeId: templateInstanceNodeId("note", "guidance"),
          parentNodeId: "note",
          anchor: end,
        },
      ],
    );
    const expected = summary(
      rebuildGeneration(
        "workspace",
        admitted([...merged.facts, detachedNode, detachedOwner, detach, detachedOccurrence]),
        versions,
      ),
    );

    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = admitted(
        shuffle(
          [...base.values, remove, removePlacement, add, detachedNode, detachedOwner, detach, detachedOccurrence, add],
          seed,
        ),
      );
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toEqual(expected);
      expect(full.generation.origin.supertagTemplateNodes.supertag).toEqual(["guidance"]);
      expect(full.generation.origin.templateNodeInstances[0]).toMatchObject({
        state: "detached",
        instanceNodeId: templateInstanceNodeId("note", "guidance"),
        detachmentContributionIds: [detach.id],
      });
      expect(
        textAtoms(full.generation.origin.nodes[templateInstanceNodeId("note", "guidance")])
          .map((atom) => atom.value)
          .join(""),
      ).toBe("Guidance");
    }

    const before = rebuildGeneration("workspace", baseSnapshot, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", baseSnapshot, before, checkpointKey);
    const finalSnapshot = admitted([
      ...base.values,
      remove,
      removePlacement,
      add,
      detachedNode,
      detachedOwner,
      detach,
      detachedOccurrence,
    ]);
    const incremental = advanceGeneration("workspace", baseSnapshot, finalSnapshot, versions, before);
    const checkpointTail = reconcileFromCheckpoint(checkpoint, "workspace", finalSnapshot, versions, checkpointKey);
    expect(summary(incremental)).toEqual(expected);
    expect(summary(checkpointTail)).toEqual(expected);
  });
});

function fixture(): Facts {
  const facts = new Facts();
  facts.addPlaced("supertag");
  facts.add({ kind: "intrinsic-node-type-declare", nodeId: "supertag", intrinsicNodeType: "supertag-definition" });
  facts.addPlaced("guidance");
  facts.addPlaced("note", "workspace", "note-occurrence");
  facts.add({
    kind: "text-splice",
    nodeId: "guidance",
    deleteAtomIds: [],
    deletedAtoms: [],
    anchor: end,
    insert: "Guidance",
  });
  facts.add({
    kind: "supertag-template-node-add",
    supertagId: "supertag",
    templateNodeId: "guidance",
    templateOccurrenceId: "supertag-guidance-template-occurrence",
    anchor: end,
  });
  facts.applySupertag("note", "supertag");
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

function remoteFacts(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  mutations: readonly [Mutation, Mutation],
): readonly [Fact, Fact];
function remoteFacts(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  mutations: readonly [Mutation, Mutation, Mutation],
): readonly [Fact, Fact, Fact];
function remoteFacts(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  mutations: readonly [Mutation, Mutation, Mutation, Mutation],
): readonly [Fact, Fact, Fact, Fact];
function remoteFacts(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  mutations: readonly Mutation[],
): readonly Fact[] {
  const transactionId = factTransactionId("workspace", replicaId, 1);
  return mutations.map((mutation, index) =>
    makeFact({
      workspaceId: "workspace",
      replicaId,
      sequence: index + 1,
      observed: { ...observed, ...(index > 0 ? { [replicaId]: index } : {}) },
      lamport: lamport + index,
      transaction: { transactionId, index, size: mutations.length },
      body: { kind: "contribution", actorId: replicaId, intent: "direct", mutation },
    }),
  );
}

function admitted(facts: readonly Fact[]) {
  const admission = admitAuthorityRecords(
    "workspace",
    facts.map((fact) => ({ recordKind: "fact" as const, fact })),
  );
  if (admission.kind === "fault") {
    throw new Error(admission.fault ?? "Template Node admission failed");
  }
  return admission.snapshot;
}

function summary(result: ReturnType<typeof rebuildGeneration> | null): string {
  if (result === null) {
    throw new Error("Expected checkpoint-tail Reconcile result");
  }
  return canonicalJson({ origin: result.generation.origin, review: result.generation.review });
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
