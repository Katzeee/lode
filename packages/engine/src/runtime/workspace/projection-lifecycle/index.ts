import type { FactSnapshot, ProjectionIdentity } from "../../../domain/fact/index.js";
import {
  advanceGeneration,
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../../domain/reconcile/index.js";
import { InMemoryDocumentStore } from "../../../persistence/in-memory-document-store.js";
import {
  BoundedProjectionMaterializer,
  type ProjectionCheckpointStore,
  type ProjectionGenerationReader,
  type ProjectionIdentityReader,
  type ProjectionSectionPageReader,
  type ProjectionPublisher,
  type ProjectionSupertagInstancesReader,
  type ProjectionSnapshotReader,
  type ReviewReadModelReader,
} from "../../materialization/index.js";
import { publishProjectionGeneration, type ProjectionPublication } from "./publication.js";

export type WorkspaceProjectionAccess = ProjectionPublisher &
  ProjectionGenerationReader &
  ProjectionIdentityReader &
  ProjectionSnapshotReader &
  ProjectionSectionPageReader &
  ReviewReadModelReader &
  ProjectionSupertagInstancesReader;

export type ProjectionLifecycleOptions = Readonly<{
  projections?: WorkspaceProjectionAccess;
  checkpoints?: ProjectionCheckpointStore;
}>;

export type ProjectionAdvance = Readonly<{
  eventKind: "projection-published" | "projection-recovered";
  identity: ProjectionIdentity;
}>;

export type ProjectionLifecycleEvent = Readonly<{
  kind: "projection-published" | "projection-failed" | "projection-recovered";
  frontier: FactSnapshot["frontier"];
  generationId: string | null;
}>;

export class WorkspaceProjectionLifecycle {
  private projectionFailure: string | null = null;

  private constructor(
    private readonly workspaceId: string,
    private readonly versions: ProjectionVersions,
    private readonly access: WorkspaceProjectionAccess,
    private readonly publication: ProjectionPublication,
    private generation: ProjectionGeneration,
    private snapshot: FactSnapshot,
    private readonly notify: (event: ProjectionLifecycleEvent) => void,
  ) {}

  static async open(
    workspaceId: string,
    snapshot: FactSnapshot,
    versions: ProjectionVersions,
    options: ProjectionLifecycleOptions = {},
    notify: (event: ProjectionLifecycleEvent) => void = () => undefined,
  ): Promise<WorkspaceProjectionLifecycle> {
    const access = options.projections ?? new BoundedProjectionMaterializer(new InMemoryDocumentStore());
    const checkpoint = await options.checkpoints?.load(snapshot, versions);
    const generation =
      checkpoint?.kind === "valid"
        ? checkpoint.generation
        : rebuildGeneration(workspaceId, snapshot, versions).generation;
    const publication: ProjectionPublication = {
      projections: access,
      ...(options.checkpoints ? { checkpoints: options.checkpoints } : {}),
    };
    await publishProjectionGeneration(generation, snapshot, publication);
    return new WorkspaceProjectionLifecycle(workspaceId, versions, access, publication, generation, snapshot, notify);
  }

  get identity(): ProjectionIdentity {
    return this.generation.identity;
  }

  get publishedSnapshot(): FactSnapshot {
    return this.snapshot;
  }

  get failure(): string | null {
    return this.projectionFailure;
  }

  get projections(): WorkspaceProjectionAccess {
    return this.access;
  }

  async advance(snapshot: FactSnapshot): Promise<ProjectionAdvance> {
    const acknowledgedGenerationId = this.generation.identity.generationId;
    try {
      return await this.access.withReadLease(acknowledgedGenerationId, async () => {
        const previous = freezeProjectionGeneration(await this.access.load(acknowledgedGenerationId));
        const reconcile = advanceGeneration(this.workspaceId, this.snapshot, snapshot, this.versions, previous);
        await publishProjectionGeneration(reconcile.generation, snapshot, this.publication);
        const eventKind = this.projectionFailure === null ? "projection-published" : "projection-recovered";
        this.generation = reconcile.generation;
        this.snapshot = snapshot;
        this.projectionFailure = null;
        const advanced = { eventKind, identity: reconcile.generation.identity } as const;
        this.notify({
          kind: advanced.eventKind,
          frontier: snapshot.frontier,
          generationId: advanced.identity.generationId,
        });
        return advanced;
      });
    } catch (error) {
      this.projectionFailure = error instanceof Error ? error.message : String(error);
      this.notify({ kind: "projection-failed", frontier: snapshot.frontier, generationId: null });
      throw error;
    }
  }
}

function freezeProjectionGeneration<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freezeProjectionGeneration(child);
  }
  return value;
}
