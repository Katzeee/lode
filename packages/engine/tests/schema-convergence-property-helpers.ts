import { expect } from "vitest";

import { admitAuthorityRecords } from "../src/domain/admission/index.js";
import {
  canonicalJson,
  makeFact,
  type Fact,
  type FactFrontier,
  type FactSnapshot,
  type Mutation,
} from "../src/domain/fact/index.js";
import {
  advanceGeneration,
  rebuildGeneration,
  type ProjectionGeneration,
} from "../src/domain/reconcile/index.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
} from "../src/runtime/workspace/generation-checkpoint.js";

const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;
const checkpointKey = "schema-convergence-property";

export function remoteBranch(
  replicaId: string,
  observed: FactFrontier,
  lamport: number,
  mutations: readonly Mutation[],
): readonly Fact[] {
  return mutations.map((mutation, index) =>
    makeFact({
      workspaceId: "workspace",
      replicaId,
      sequence: index + 1,
      observed: { ...observed, ...(index === 0 ? {} : { [replicaId]: index }) },
      lamport: lamport + index,
      body: { kind: "contribution", actorId: replicaId, intent: "direct", mutation },
    }),
  );
}

export function admitted(facts: readonly Fact[]): FactSnapshot {
  const admission = admitAuthorityRecords(
    "workspace",
    facts.map((fact) => ({ recordKind: "fact" as const, fact })),
  );
  if (admission.kind === "fault") {
    throw new Error(admission.fault ?? "Schema convergence admission failed");
  }
  return admission.snapshot;
}

export function assertSchemaConvergence(
  prefixCount: number,
  facts: readonly Fact[],
  inspect: (generation: ProjectionGeneration) => void,
): void {
  const expectedSnapshot = admitted(facts);
  const expected = rebuildGeneration("workspace", expectedSnapshot, versions).generation;
  const expectedSummary = canonicalJson(expected);
  inspect(expected);

  for (let seed = 1; seed <= 32; seed += 1) {
    const duplicates = facts.filter((_, index) => index >= prefixCount && index % 2 === seed % 2);
    const delivered = shuffle([...facts, ...duplicates], seed);
    const snapshot = admitted(delivered);
    const full = rebuildGeneration("workspace", snapshot, versions);
    expect(canonicalJson(full.generation)).toBe(expectedSummary);

    const tailLength = facts.length - prefixCount;
    const cut = prefixCount + (tailLength === 0 ? 0 : seed % tailLength);
    const beforeSnapshot = admitted(facts.slice(0, cut));
    const before = rebuildGeneration("workspace", beforeSnapshot, versions).generation;
    const incremental = advanceGeneration("workspace", beforeSnapshot, snapshot, versions, before);
    expect(canonicalJson(incremental.generation)).toBe(expectedSummary);

    const checkpoint = createGenerationCheckpoint(
      "workspace",
      beforeSnapshot,
      before,
      checkpointKey,
    );
    const checkpointTail = reconcileFromCheckpoint(
      checkpoint,
      "workspace",
      snapshot,
      versions,
      checkpointKey,
    );
    expect(canonicalJson(checkpointTail?.generation)).toBe(expectedSummary);

    const restarted = rebuildGeneration("workspace", structuredClone(snapshot), versions);
    expect(canonicalJson(restarted.generation)).toBe(expectedSummary);
    inspect(full.generation);
  }
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
