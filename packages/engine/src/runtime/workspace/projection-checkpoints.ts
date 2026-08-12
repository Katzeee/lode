import { canonicalJson, type FactSnapshot } from "../../domain/fact/index.js";
import {
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../domain/reconcile/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { createGenerationCheckpoint, reconcileFromCheckpoint } from "./generation-checkpoint.js";

const PROJECTION_CHECKPOINT_DOCUMENT_ID = "projection-checkpoint";

export type CheckpointLoad =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid"; reason: string }>
  | Readonly<{ kind: "valid"; generation: ProjectionGeneration }>;

export class ProjectionCheckpointRepository {
  constructor(
    private readonly documents: DocumentStore,
    private readonly integrityKey: string,
  ) {}

  async load(
    workspaceId: string,
    snapshot: FactSnapshot,
    versions: ProjectionVersions,
  ): Promise<CheckpointLoad> {
    const stored = await this.documents.load(PROJECTION_CHECKPOINT_DOCUMENT_ID);
    if (!stored) {
      return { kind: "missing" };
    }
    if (!stored.snapshot || stored.updates.length > 0) {
      return { kind: "invalid", reason: "checkpoint storage shape is invalid" };
    }
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(stored.snapshot));
      const result = reconcileFromCheckpoint(
        parsed,
        workspaceId,
        snapshot,
        versions,
        this.integrityKey,
      );
      return result
        ? { kind: "valid", generation: result.generation }
        : { kind: "invalid", reason: "checkpoint identity or integrity does not validate" };
    } catch (error) {
      return {
        kind: "invalid",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  save(
    workspaceId: string,
    snapshot: FactSnapshot,
    generation: ProjectionGeneration,
  ): Promise<void> {
    const checkpoint = createGenerationCheckpoint(
      workspaceId,
      snapshot,
      generation,
      this.integrityKey,
    );
    return this.documents.writeSnapshot(
      PROJECTION_CHECKPOINT_DOCUMENT_ID,
      new TextEncoder().encode(canonicalJson(checkpoint)),
    );
  }
}
