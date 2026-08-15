import { describe, expect, it } from "vitest";

import { canonicalDigest, frontierOf, makeFact } from "../../domain/fact/index.js";
import { createGenerationCheckpoint, reconcileFromCheckpoint } from "./generation-checkpoint.js";
import type { FactSnapshot } from "../../domain/fact/index.js";
import type { ProjectionVersions } from "../../domain/reconcile/index.js";
import { rebuildGeneration } from "../../domain/reconcile/reconcile.js";

const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const versions = { rulesVersion: "proposal-rules-5", schemaVersion: "lode-schema-19" } as const;
const INTEGRITY_KEY = "checkpoint-test-key";

describe("generation checkpoints", () => {
  it("DUR-1 checkpoints validate identity frontier versions and integrity", () => {
    const fact = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "node" },
      },
    });
    const snapshot = { facts: [fact], frontier: frontierOf([fact]) };
    const generation = rebuildGeneration("workspace", snapshot, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", snapshot, generation, INTEGRITY_KEY);

    expect(generationFromCheckpoint(checkpoint, "workspace", snapshot, versions)).toEqual(generation);
    expect(
      generationFromCheckpoint({ ...checkpoint, projectionDigest: "corrupt" }, "workspace", snapshot, versions),
    ).toBeNull();
    expect(
      generationFromCheckpoint(checkpoint, "workspace", snapshot, {
        ...versions,
        rulesVersion: "unknown-rules",
      }),
    ).toBeNull();
  });

  it("reconciles a valid tail and rejects mismatched checkpoint shapes", () => {
    const first = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "node" },
      },
    });
    const before = { facts: [first], frontier: frontierOf([first]) };
    const generation = rebuildGeneration("workspace", before, versions).generation;
    const checkpoint = createGenerationCheckpoint("workspace", before, generation, INTEGRITY_KEY);
    expect(generationFromCheckpoint(checkpoint, "other", before, versions)).toBeNull();

    const second = makeFact({
      workspaceId: "workspace",
      replicaId: REPLICA,
      sequence: 2,
      observed: { [REPLICA]: 1 },
      lamport: 2,
      body: {
        kind: "contribution",
        actorId: "actor",
        intent: "direct",
        mutation: { kind: "node-create", nodeId: "tail" },
      },
    });
    const after = { facts: [second, first], frontier: frontierOf([first, second]) };
    expect(reconcileFromCheckpoint(checkpoint, "workspace", after, versions, INTEGRITY_KEY)?.generation).toEqual(
      rebuildGeneration("workspace", after, versions).generation,
    );

    const mismatchedGeneration = {
      ...checkpoint.generation,
      origin: {
        ...checkpoint.generation.origin,
        identity: {
          ...checkpoint.generation.origin.identity,
          schemaVersion: "other",
        },
      },
    };
    const mismatched = {
      ...checkpoint,
      generation: mismatchedGeneration,
      projectionDigest: canonicalDigest(mismatchedGeneration),
    };
    expect(generationFromCheckpoint(mismatched, "workspace", before, versions)).toBeNull();

    const wrongGeneration = {
      ...checkpoint.generation,
      origin: { ...checkpoint.generation.origin, view: "review" },
    };
    const wrongView = {
      ...checkpoint,
      generation: wrongGeneration,
      projectionDigest: canonicalDigest(wrongGeneration),
    };
    expect(generationFromCheckpoint(wrongView, "workspace", before, versions)).toBeNull();
    expect(generationFromCheckpoint({ ...checkpoint, future: true }, "workspace", before, versions)).toBeNull();
    expect(generationFromCheckpoint({ format: "broken" }, "workspace", before, versions)).toBeNull();
  });
});

function generationFromCheckpoint(
  checkpoint: unknown,
  workspaceId: string,
  snapshot: FactSnapshot,
  checkpointVersions: ProjectionVersions,
) {
  return (
    reconcileFromCheckpoint(checkpoint, workspaceId, snapshot, checkpointVersions, INTEGRITY_KEY)?.generation ?? null
  );
}
