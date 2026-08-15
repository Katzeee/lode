import type { ProjectionIdentity, ViewMode } from "../../domain/fact/index.js";
import type { ProjectionGeneration, ProjectionSectionName } from "../../domain/reconcile/index.js";
import type { ReviewReadModel } from "../../domain/review/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { BoundedMaterializedStore } from "./bounded-materialized-store.js";
import { MATERIALIZED_DATASETS } from "./materialized-datasets.js";
import { reviewReadModelEntries } from "./materialized-review-read-model.js";
import type { ProjectionShardBatch, ProjectionSliceName } from "./projection-slices.js";
import {
  loadProjectionGeneration,
  readProjectionSectionPage,
  readProjectionSchemaSearch,
  readProjectionSlice,
} from "./projection-materialized-reader.js";
import { projectionMaterializedEntries } from "./projection-materialized-dataset.js";
import { readReviewScopes, readReviewSupport } from "./review-materialized-reader.js";

export type BoundedMaterializerOptions = Readonly<{
  capacity?: number;
}>;

export class BoundedProjectionMaterializer {
  private readonly store: BoundedMaterializedStore<ProjectionIdentity>;

  constructor(documents: DocumentStore, options: BoundedMaterializerOptions = {}) {
    const capacity = options.capacity ?? 128;
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error("Materializer capacity must be a positive safe integer");
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
    view: ViewMode,
    section: Section,
    after: string | null,
    limit: number,
  ) {
    return this.store.read(generationId, (generation) =>
      readProjectionSectionPage(generation, view, section, after, limit),
    );
  }

  async schemaSearch(generationId: string, view: ViewMode, schemaId: string, after: string | null, limit: number) {
    return this.store.read(generationId, (generation) =>
      readProjectionSchemaSearch(generation, view, schemaId, after, limit),
    );
  }

  async read<Section extends ProjectionSliceName>(
    generationId: string,
    view: ViewMode,
    section: Section,
    identities: readonly string[],
  ): Promise<ProjectionShardBatch<Section>> {
    return this.store.read(generationId, (generation) => readProjectionSlice(generation, view, section, identities));
  }

  async withReadLease<T>(generationId: string, read: () => Promise<T>): Promise<T> {
    return this.store.withLease(generationId, read);
  }
}
