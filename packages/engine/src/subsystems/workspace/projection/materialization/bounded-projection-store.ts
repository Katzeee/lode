import type { ProjectionIdentity, ProjectionPerspective } from "../../../../domain/fact/index.js";
import type { ProjectionGeneration, ProjectionSectionName } from "../../../../domain/reconcile/index.js";
import type { ReviewReadModel } from "../../../../domain/review/index.js";
import type { DocumentStore } from "../../../persistence/index.js";
import { BoundedMaterializedStore } from "./store/bounded-materialized-store.js";
import { MATERIALIZED_DATASETS } from "./materialized-datasets.js";
import { REVIEW_MATERIALIZED_DATASETS, reviewReadModelEntries } from "./materialized-review-read-model.js";
import type { ProjectionShardBatch, ProjectionSliceName } from "./projection-slices.js";
import {
  loadProjectionGeneration,
  readProjectionSectionPage,
  readProjectionSupertagInstances,
  readProjectionSlice,
} from "./projection-materialized-reader.js";
import { projectionMaterializedEntries } from "./projection-materialized-dataset.js";
import { readReviewScopes, readReviewSupport } from "./review-materialized-reader.js";
import type { ProjectionStoreRestore } from "./ports.js";

export type BoundedProjectionStoreOptions = Readonly<{
  capacity?: number;
}>;

export class BoundedProjectionStore {
  private readonly store: BoundedMaterializedStore<ProjectionIdentity>;

  constructor(documents: DocumentStore, options: BoundedProjectionStoreOptions = {}) {
    const capacity = options.capacity ?? 128;
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error("Projection store capacity must be a positive safe integer");
    }
    this.store = new BoundedMaterializedStore(documents, MATERIALIZED_DATASETS, capacity);
  }

  async publish(generation: ProjectionGeneration, review: ReviewReadModel): Promise<void> {
    await this.store.publish(generation.identity, [
      ...projectionMaterializedEntries(generation),
      ...reviewReadModelEntries(review),
    ]);
  }

  async load(generationId: string): Promise<ProjectionGeneration> {
    return this.store.read(generationId, loadProjectionGeneration);
  }

  async restore(generationId: string): Promise<ProjectionStoreRestore> {
    const restored = await this.store.restore(generationId, async (generation) => {
      const [projection] = await Promise.all([
        loadProjectionGeneration(generation),
        ...REVIEW_MATERIALIZED_DATASETS.map((dataset) => generation.all(dataset)),
      ]);
      return projection;
    });
    return restored.kind === "found" ? { kind: "found", generation: restored.value } : restored;
  }

  storedIdentities(): Promise<readonly ProjectionIdentity[]> {
    return this.store.storedIdentities();
  }

  async identity(generationId: string): Promise<ProjectionIdentity> {
    return this.store.read(generationId, (generation) => Promise.resolve(generation.identity));
  }

  async reviewScopes(generationId: string, after: string | null, limit: number) {
    return this.store.read(generationId, (generation) => readReviewScopes(generation, after, limit));
  }

  async reviewSupport(generationId: string, contributionIds: readonly string[]) {
    return this.store.read(generationId, (generation) => readReviewSupport(generation, contributionIds));
  }

  async page<Section extends ProjectionSectionName>(
    generationId: string,
    perspective: ProjectionPerspective,
    section: Section,
    after: string | null,
    limit: number,
  ) {
    return this.store.read(generationId, (generation) =>
      readProjectionSectionPage(generation, perspective, section, after, limit),
    );
  }

  async supertagInstances(
    generationId: string,
    perspective: ProjectionPerspective,
    supertagId: string,
    after: string | null,
    limit: number,
  ) {
    return this.store.read(generationId, (generation) =>
      readProjectionSupertagInstances(generation, perspective, supertagId, after, limit),
    );
  }

  async read<Section extends ProjectionSliceName>(
    generationId: string,
    perspective: ProjectionPerspective,
    section: Section,
    identities: readonly string[],
  ): Promise<ProjectionShardBatch<Section>> {
    return this.store.read(generationId, (generation) =>
      readProjectionSlice(generation, perspective, section, identities),
    );
  }
}
