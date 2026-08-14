import { canonicalJson, type FactSnapshot } from "../../domain/fact/index.js";
import {
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../domain/reconcile/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { createGenerationCheckpoint, reconcileFromCheckpoint } from "./generation-checkpoint.js";
import type { ProjectionCheckpointLoad, ProjectionCheckpointStore } from "./ports.js";

const PROJECTION_CHECKPOINT_DOCUMENT_ID = "projection-checkpoint";

export class ProjectionCheckpointRepository implements ProjectionCheckpointStore {
  constructor(
    private readonly documents: DocumentStore,
    private readonly workspaceId: string,
    private readonly integrityKey: string,
  ) {}

  async load(
    snapshot: FactSnapshot,
    versions: ProjectionVersions,
  ): Promise<ProjectionCheckpointLoad> {
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
        this.workspaceId,
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

  save(snapshot: FactSnapshot, generation: ProjectionGeneration): Promise<void> {
    const checkpoint = createGenerationCheckpoint(
      this.workspaceId,
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
