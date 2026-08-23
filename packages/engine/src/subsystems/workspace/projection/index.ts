import {
  frontierCovers,
  frontierEquals,
  stableStringCompare,
  type FactSnapshot,
  type ProjectionIdentity,
} from "../../../domain/fact/index.js";
import {
  advanceGeneration,
  projectionIdentity,
  rebuildGeneration,
  snapshotAtFrontier,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../../persistence/index.js";
import { BoundedProjectionStore, type ProjectionReader, type ProjectionStore } from "./materialization/index.js";
import { createReviewReadModel } from "../../../domain/review/index.js";

export type WorkspaceProjectionOptions = Readonly<{
  store?: ProjectionStore;
}>;

export { BoundedProjectionStore } from "./materialization/index.js";
export type {
  ProjectionIdentityReader,
  ProjectionListIndexName,
  ProjectionReader,
  ProjectionSectionPageReader,
  ProjectionSliceName,
  ProjectionSlicePage,
  ProjectionSliceValue,
  ProjectionSnapshotReader,
  ProjectionSupertagInstancesReader,
  ReviewReadModelReader,
} from "./materialization/index.js";

type ProjectionAdvance = Readonly<{
  eventKind: "projection-published" | "projection-recovered";
  identity: ProjectionIdentity;
}>;

type WorkspaceProjectionEvent = Readonly<{
  kind: "projection-published" | "projection-failed" | "projection-recovered";
  frontier: FactSnapshot["frontier"];
  generationId: string | null;
}>;

export class WorkspaceProjection {
  private projectionFailure: string | null = null;

  private constructor(
    private readonly workspaceId: string,
    private readonly versions: ProjectionVersions,
    private readonly store: ProjectionStore,
    private generation: ProjectionGeneration,
    private snapshot: FactSnapshot,
    private readonly notify: (event: WorkspaceProjectionEvent) => void,
  ) {}

  static async open(
    workspaceId: string,
    snapshot: FactSnapshot,
    versions: ProjectionVersions,
    options: WorkspaceProjectionOptions = {},
    notify: (event: WorkspaceProjectionEvent) => void = () => undefined,
  ): Promise<WorkspaceProjection> {
    const store = options.store ?? new BoundedProjectionStore(new InMemoryDocumentStore());
    const expectedIdentity = projectionIdentity(workspaceId, snapshot, versions);
    const restored = await store.restore(expectedIdentity.generationId);
    let generation: ProjectionGeneration;
    if (restored.kind === "found" && sameProjectionIdentity(restored.generation.identity, expectedIdentity)) {
      generation = restored.generation;
    } else {
      generation =
        (await restoreCompatibleGeneration(store, workspaceId, snapshot, versions, expectedIdentity.generationId)) ??
        rebuildGeneration(workspaceId, snapshot, versions);
      await store.publish(generation, createReviewReadModel(snapshot, generation));
    }
    return new WorkspaceProjection(workspaceId, versions, store, generation, snapshot, notify);
  }

  get identity(): ProjectionIdentity {
    return this.generation.identity;
  }

  get publishedSnapshot(): FactSnapshot {
    return this.snapshot;
  }

  get currentGeneration(): ProjectionGeneration {
    return this.generation;
  }

  get failure(): string | null {
    return this.projectionFailure;
  }

  get reader(): ProjectionReader {
    return this.store;
  }

  async advance(snapshot: FactSnapshot): Promise<ProjectionAdvance> {
    const previous = this.generation;
    try {
      const generation = advanceGeneration(this.workspaceId, this.snapshot, snapshot, this.versions, previous);
      await this.store.publish(generation, createReviewReadModel(snapshot, generation));
      const eventKind = this.projectionFailure === null ? "projection-published" : "projection-recovered";
      this.generation = generation;
      this.snapshot = snapshot;
      this.projectionFailure = null;
      const advanced = { eventKind, identity: generation.identity } as const;
      this.notify({
        kind: advanced.eventKind,
        frontier: snapshot.frontier,
        generationId: advanced.identity.generationId,
      });
      return advanced;
    } catch (error) {
      this.projectionFailure = error instanceof Error ? error.message : String(error);
      this.notify({ kind: "projection-failed", frontier: snapshot.frontier, generationId: null });
      throw error;
    }
  }
}

async function restoreCompatibleGeneration(
  store: ProjectionStore,
  workspaceId: string,
  snapshot: FactSnapshot,
  versions: ProjectionVersions,
  expectedGenerationId: string,
): Promise<ProjectionGeneration | null> {
  const identities = (await store.storedIdentities())
    .filter(
      (identity) =>
        identity.generationId !== expectedGenerationId &&
        identity.workspaceNodeId === workspaceId &&
        identity.rulesVersion === versions.rulesVersion &&
        identity.schemaVersion === versions.schemaVersion &&
        frontierCovers(snapshot.frontier, identity.frontier),
    )
    .sort(compareNewestIdentity);
  for (const identity of identities) {
    const restored = await store.restore(identity.generationId);
    if (restored.kind === "found" && sameProjectionIdentity(restored.generation.identity, identity)) {
      return advanceGeneration(
        workspaceId,
        snapshotAtFrontier(snapshot, identity.frontier),
        snapshot,
        versions,
        restored.generation,
      );
    }
  }
  return null;
}

function compareNewestIdentity(left: ProjectionIdentity, right: ProjectionIdentity): number {
  const leftSize = Object.values(left.frontier).reduce((total, sequence) => total + sequence, 0);
  const rightSize = Object.values(right.frontier).reduce((total, sequence) => total + sequence, 0);
  return rightSize - leftSize || stableStringCompare(left.generationId, right.generationId);
}

function sameProjectionIdentity(left: ProjectionIdentity, right: ProjectionIdentity): boolean {
  return (
    left.workspaceNodeId === right.workspaceNodeId &&
    left.generationId === right.generationId &&
    left.rulesVersion === right.rulesVersion &&
    left.schemaVersion === right.schemaVersion &&
    frontierEquals(left.frontier, right.frontier)
  );
}
