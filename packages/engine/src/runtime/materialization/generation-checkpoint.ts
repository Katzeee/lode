import { createHmac } from "node:crypto";

import {
  canonicalDigest,
  compareFacts,
  frontierCovers,
  frontierEquals,
  type FactSnapshot,
} from "../../domain/fact/index.js";
import {
  advanceGeneration,
  assertSupportedProjectionVersions,
  snapshotAtFrontier,
  type ProjectionGeneration,
  type ProjectionVersions,
  type ReconcileResult,
} from "../../domain/reconcile/index.js";

const GENERATION_CHECKPOINT_FORMAT = "lode-generation-checkpoint-v3" as const;

export type GenerationCheckpoint = Readonly<{
  format: typeof GENERATION_CHECKPOINT_FORMAT;
  workspaceId: string;
  factsDigest: string;
  projectionDigest: string;
  integrity: string;
  generation: ProjectionGeneration;
}>;

export function createGenerationCheckpoint(
  workspaceId: string,
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  integrityKey: string,
): GenerationCheckpoint {
  if (!frontierEquals(snapshot.frontier, generation.identity.frontier)) {
    throw new Error("Checkpoint generation frontier does not match its Facts");
  }
  const unsigned = {
    format: GENERATION_CHECKPOINT_FORMAT,
    workspaceId,
    factsDigest: canonicalDigest([...snapshot.facts].sort(compareFacts)),
    projectionDigest: canonicalDigest(generation),
    generation,
  };
  return { ...unsigned, integrity: signCheckpoint(unsigned, integrityKey) };
}

function validateGenerationCheckpoint(
  checkpoint: unknown,
  workspaceId: string,
  snapshot: FactSnapshot,
  versions: ProjectionVersions,
  integrityKey: string,
): ProjectionGeneration | null {
  try {
    assertCheckpointEnvelope(checkpoint);
    assertSupportedProjectionVersions(versions);
    const expectedGenerationId = canonicalDigest({
      workspaceId,
      frontier: checkpoint.generation.identity.frontier,
      rulesVersion: versions.rulesVersion,
      schemaVersion: versions.schemaVersion,
    });
    const unsigned = unsignedCheckpoint(checkpoint);
    if (
      checkpoint.workspaceId !== workspaceId ||
      checkpoint.integrity !== signCheckpoint(unsigned, integrityKey) ||
      checkpoint.generation.identity.rulesVersion !== versions.rulesVersion ||
      checkpoint.generation.identity.schemaVersion !== versions.schemaVersion ||
      checkpoint.generation.identity.generationId !== expectedGenerationId ||
      checkpoint.generation.origin.view !== "origin" ||
      checkpoint.generation.review.view !== "review" ||
      canonicalDigest(checkpoint.generation.identity) !== canonicalDigest(checkpoint.generation.origin.identity) ||
      canonicalDigest(checkpoint.generation.identity) !== canonicalDigest(checkpoint.generation.review.identity) ||
      !frontierCovers(snapshot.frontier, checkpoint.generation.identity.frontier) ||
      checkpoint.factsDigest !==
        canonicalDigest(snapshotAtFrontier(snapshot, checkpoint.generation.identity.frontier).facts) ||
      checkpoint.projectionDigest !== canonicalDigest(checkpoint.generation)
    ) {
      return null;
    }
    return checkpoint.generation;
  } catch {
    return null;
  }
}

export function reconcileFromCheckpoint(
  checkpoint: unknown,
  workspaceId: string,
  snapshot: FactSnapshot,
  versions: ProjectionVersions,
  integrityKey: string,
): ReconcileResult | null {
  const generation = validateGenerationCheckpoint(checkpoint, workspaceId, snapshot, versions, integrityKey);
  if (!generation) {
    return null;
  }
  if (frontierEquals(generation.identity.frontier, snapshot.frontier)) {
    return { generation, stats: { evaluatedStages: [], supportPasses: 0 } };
  }
  return advanceGeneration(
    workspaceId,
    snapshotAtFrontier(snapshot, generation.identity.frontier),
    snapshot,
    versions,
    generation,
  );
}

function signCheckpoint(checkpoint: Omit<GenerationCheckpoint, "integrity">, integrityKey: string): string {
  return createHmac("sha256", integrityKey).update(canonicalDigest(checkpoint)).digest("hex");
}

function unsignedCheckpoint(checkpoint: GenerationCheckpoint): Omit<GenerationCheckpoint, "integrity"> {
  const { integrity: _integrity, ...unsigned } = checkpoint;
  return unsigned;
}

function assertCheckpointEnvelope(value: unknown): asserts value is GenerationCheckpoint {
  const checkpoint = record(value);
  assertExactKeys(checkpoint, ["format", "workspaceId", "factsDigest", "projectionDigest", "integrity", "generation"]);
  if (checkpoint.format !== GENERATION_CHECKPOINT_FORMAT) {
    throw new Error("Checkpoint format is unsupported");
  }
  const generation = record(checkpoint.generation);
  assertExactKeys(generation, ["identity", "origin", "review", "planCaches"]);
  const planCaches = record(generation.planCaches);
  assertExactKeys(planCaches, ["origin", "review"]);
  for (const cache of [planCaches.origin, planCaches.review]) {
    assertExactKeys(record(cache), ["activeContributionIds", "supportByContribution", "supportPasses"]);
  }
  for (const identity of [
    generation.identity,
    record(generation.origin).identity,
    record(generation.review).identity,
  ]) {
    assertExactKeys(record(identity), ["workspaceNodeId", "generationId", "frontier", "rulesVersion", "schemaVersion"]);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Checkpoint field must be an object");
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some((key) => !expected.includes(key))) {
    throw new Error("Checkpoint contains an unknown or missing field");
  }
}
