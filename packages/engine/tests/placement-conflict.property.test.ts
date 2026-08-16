import { describe, expect, it } from "vitest";

import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import { canonicalJson, makeFact, type Fact, type FactFrontier, type Mutation } from "../src/domain/fact/index.js";
import {
  advanceGeneration,
  rebuildGeneration,
  CURRENT_PROJECTION_VERSIONS as versions,
} from "../src/domain/reconcile/index.js";
import { end, Facts } from "./support/reconcile/reconcile-test-helpers.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/materialization/generation-checkpoint.js";

const moveReplicaB = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const moveReplicaC = "cccccccccccccccccccccccccc";
const unrelatedReplica = "dddddddddddddddddddddddddd";
const checkpointKey = "placement-conflict-property";
const previousAnchor = {
  after: "parent-c-occurrence",
  before: null,
  affinity: "after",
  fallback: "end",
} as const;

describe("Placement Conflict convergence", () => {
  it("preserves both cross-parent move intents across 32 arrival and replay topologies", () => {
    const base = fixture();
    const baseSnapshot = admitted(base.values);
    const frontier = baseSnapshot.frontier;
    const moveB = remoteMove(moveReplicaB, frontier, "parent-b");
    const moveC = remoteMove(moveReplicaC, frontier, "parent-c");
    const unrelated = remoteFact(unrelatedReplica, frontier, {
      kind: "text-splice",
      nodeId: "unrelated",
      deleteAtomIds: [],
      deletedAtoms: [],
      anchor: end,
      insert: "x",
    });
    const expectedSnapshot = admitted([...base.values, moveB, moveC, unrelated]);
    const expected = rebuildGeneration("workspace", expectedSnapshot, versions);
    const expectedSummary = summary(expected);

    for (let seed = 1; seed <= 32; seed += 1) {
      const snapshot = admitted(shuffle([...base.values, moveB, moveC, unrelated, moveB], seed));
      const full = rebuildGeneration("workspace", snapshot, versions);
      expect(summary(full)).toBe(expectedSummary);
      const issue = Object.values(full.generation.origin.conflictIssues)[0];
      expect(issue).toMatchObject({
        kind: "placement-conflict",
        occurrenceId: "value-occurrence",
        candidates: [
          { contributionId: moveB.id, parentNodeId: "parent-b" },
          { contributionId: moveC.id, parentNodeId: "parent-c" },
        ],
      });
      expect(full.generation.review.conflictIssues).toEqual(full.generation.origin.conflictIssues);
      expect(full.generation.review.occurrences["value-occurrence"]?.parentNodeId).toBe(
        full.generation.origin.occurrences["value-occurrence"]?.parentNodeId,
      );
    }

    const before = rebuildGeneration("workspace", baseSnapshot, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", baseSnapshot, before, checkpointKey);
    const incremental = advanceGeneration("workspace", baseSnapshot, expectedSnapshot, versions, before);
    const checkpointTail = reconcileFromCheckpoint(checkpoint, "workspace", expectedSnapshot, versions, checkpointKey);
    expect(summary(incremental)).toBe(expectedSummary);
    expect(summary(checkpointTail)).toBe(expectedSummary);
  });
});

function fixture(): Facts {
  const facts = new Facts();
  for (const suffix of ["b", "c"]) {
    facts.addPlaced(`parent-${suffix}`, "workspace", `parent-${suffix}-occurrence`);
  }
  facts.addPlaced("value", "workspace", "value-occurrence");
  facts.addPlaced("unrelated", "value");
  return facts;
}

function remoteMove(replicaId: string, observed: FactFrontier, parentNodeId: string): Fact {
  return remoteFact(replicaId, observed, {
    kind: "occurrence-move",
    occurrenceId: "value-occurrence",
    parentNodeId,
    anchor: end,
    previousParentNodeId: "workspace",
    previousAnchor,
  });
}

function remoteFact(replicaId: string, observed: FactFrontier, mutation: Mutation): Fact {
  return makeFact({
    workspaceId: "workspace",
    replicaId,
    sequence: 1,
    observed,
    lamport: Object.values(observed).reduce((maximum, value) => Math.max(maximum, value), 0) + 1,
    body: { kind: "contribution", actorId: replicaId, intent: "direct", mutation },
  });
}

function admitted(facts: readonly Fact[]) {
  const admission = admitAuthorityRecords(
    "workspace",
    facts.map((fact) => ({ recordKind: "fact" as const, fact })),
  );
  if (admission.kind === "fault") {
    throw new Error(admission.fault ?? "Placement fixture admission failed");
  }
  return admission.snapshot;
}

function summary(result: ReturnType<typeof rebuildGeneration> | null): string {
  if (!result) {
    throw new Error("Expected Placement Conflict Reconcile result");
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
