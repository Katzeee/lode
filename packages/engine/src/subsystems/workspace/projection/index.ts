import { frontierCovers, type FactSnapshot, type ProjectionIdentity } from "../../../domain/fact/index.js";
import {
  rebuildGeneration,
  type ProjectionGeneration,
  type ProjectionVersions,
} from "../../../domain/reconcile/index.js";
import { createReviewReadModel, type ReviewReadModel } from "../../../domain/review/index.js";
import {
  createProjectionReadIndexes,
  type ProjectionGenerationReadIndexes,
  type ProjectionReadIndex,
} from "./read-index.js";

export type WorkspaceProjectionState = Readonly<{
  snapshot: FactSnapshot;
  generation: ProjectionGeneration;
  review: ReviewReadModel;
  indexes: ProjectionGenerationReadIndexes;
}>;

export type { ProjectionGenerationReadIndexes, ProjectionReadIndex };

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
    private state: WorkspaceProjectionState,
    private readonly notify: (event: WorkspaceProjectionEvent) => void,
  ) {}

  static open(
    workspaceId: string,
    snapshot: FactSnapshot,
    versions: ProjectionVersions,
    notify: (event: WorkspaceProjectionEvent) => void = () => undefined,
  ): WorkspaceProjection {
    const generation = rebuildGeneration(workspaceId, snapshot, versions);
    return new WorkspaceProjection(workspaceId, versions, createState(snapshot, generation), notify);
  }

  get identity(): ProjectionIdentity {
    return this.state.generation.identity;
  }

  get current(): WorkspaceProjectionState {
    return this.state;
  }

  get failure(): string | null {
    return this.projectionFailure;
  }

  advance(snapshot: FactSnapshot): void {
    const previous = this.state;
    try {
      if (!frontierCovers(snapshot.frontier, previous.snapshot.frontier)) {
        throw new Error("Next Fact snapshot does not contain the previous frontier");
      }
      const generation = rebuildGeneration(this.workspaceId, snapshot, this.versions);
      const state = createState(snapshot, generation);
      const eventKind = this.projectionFailure === null ? "projection-published" : "projection-recovered";
      this.state = state;
      this.projectionFailure = null;
      this.notify({
        kind: eventKind,
        frontier: snapshot.frontier,
        generationId: generation.identity.generationId,
      });
    } catch (error) {
      this.projectionFailure = error instanceof Error ? error.message : String(error);
      this.notify({ kind: "projection-failed", frontier: snapshot.frontier, generationId: null });
      throw error;
    }
  }
}

function createState(snapshot: FactSnapshot, generation: ProjectionGeneration): WorkspaceProjectionState {
  return {
    snapshot,
    generation,
    review: createReviewReadModel(snapshot, generation),
    indexes: createProjectionReadIndexes(generation),
  };
}
