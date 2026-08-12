import { describe, expect, it } from "vitest";

import { canonicalDigest, frontierOf, makeFact } from "../../domain/fact/index.js";
import {
  createGenerationCheckpoint,
  reconcileFromCheckpoint,
  validateGenerationCheckpoint,
} from "./generation-checkpoint.js";
import { rebuildGeneration } from "../../domain/reconcile/reconcile.js";

const REPLICA = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const versions = { rulesVersion: "proposal-rules-1", schemaVersion: "lode-schema-12" } as const;
const INTEGRITY_KEY = "checkpoint-test-key";

describe("projection checkpoints", () => {
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

    expect(
      validateGenerationCheckpoint(checkpoint, "workspace", snapshot, versions, INTEGRITY_KEY),
    ).toEqual(generation);
    expect(
      validateGenerationCheckpoint(
        { ...checkpoint, projectionDigest: "corrupt" },
        "workspace",
        snapshot,
        versions,
        INTEGRITY_KEY,
      ),
    ).toBeNull();
    expect(
      validateGenerationCheckpoint(
        checkpoint,
        "workspace",
        snapshot,
        {
          ...versions,
          rulesVersion: "unknown-rules",
        },
        INTEGRITY_KEY,
      ),
    ).toBeNull();
  });

  it("Checkpoint restart", () => {
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
    expect(
      validateGenerationCheckpoint(checkpoint, "workspace", before, versions, INTEGRITY_KEY),
    ).toEqual(generation);
    expect(
      validateGenerationCheckpoint(checkpoint, "other", before, versions, INTEGRITY_KEY),
    ).toBeNull();

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
    expect(
      reconcileFromCheckpoint(checkpoint, "workspace", after, versions, INTEGRITY_KEY)?.generation,
    ).toEqual(rebuildGeneration("workspace", after, versions).generation);

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
    expect(
      validateGenerationCheckpoint(mismatched, "workspace", before, versions, INTEGRITY_KEY),
    ).toBeNull();

    const wrongGeneration = {
      ...checkpoint.generation,
      origin: { ...checkpoint.generation.origin, view: "review" },
    };
    const wrongView = {
      ...checkpoint,
      generation: wrongGeneration,
      projectionDigest: canonicalDigest(wrongGeneration),
    };
    expect(
      validateGenerationCheckpoint(wrongView, "workspace", before, versions, INTEGRITY_KEY),
    ).toBeNull();
    expect(
      validateGenerationCheckpoint(
        { ...checkpoint, future: true },
        "workspace",
        before,
        versions,
        INTEGRITY_KEY,
      ),
    ).toBeNull();
    expect(
      validateGenerationCheckpoint(
        { format: "broken" },
        "workspace",
        before,
        versions,
        INTEGRITY_KEY,
      ),
    ).toBeNull();
  });
});
