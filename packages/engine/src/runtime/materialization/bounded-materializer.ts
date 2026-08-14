import type { ProjectionPage, ProjectionQuery } from "../../application/contract.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import type { ReviewReadModel } from "../../domain/review/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import {
  directoryRoot,
  headerDocumentId,
  type GenerationHeader,
  type ShardDescriptor,
} from "./materialized-generation-format.js";
import {
  isGenerationHeader,
  isStoredPlanCaches,
  isStoredShard,
} from "./materialized-format-validation.js";
import { projectionPage } from "./projection-page.js";
import type { BoundedMaterializerOptions } from "./bounded-materializer-types.js";
import type { ProjectionShardBatch, ProjectionSliceName, ProjectionSliceValue } from "./ports.js";
import { loadMaterializedProjection } from "./materialized-projection-loader.js";
import { SerialExecutor } from "../kernel/serial-executor.js";
import {
  loadAllDescriptors,
  loadExactDescriptors,
  loadPageDescriptors,
} from "./materialized-directory.js";
import { loadGenerationManifest, loadMaterializedSnapshot } from "./materialized-document-read.js";
import { cleanupMaterializedGenerations } from "./materialized-cleanup.js";
import { readSchemaSearchPage } from "./schema-search-reader.js";
import { BoundedShardCache } from "./bounded-shard-cache.js";
import { commitMaterializedPublication } from "./materialized-publication.js";

export class BoundedProjectionMaterializer {
  private readonly capacity: number;
  private readonly shardCache: BoundedShardCache;
  private readonly publications = new SerialExecutor();

  constructor(
    private readonly documents: DocumentStore,
    options: BoundedMaterializerOptions = {},
  ) {
    this.capacity = options.capacity ?? 128;
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1) {
      throw new Error("Materializer capacity must be a positive safe integer");
    }
    this.shardCache = new BoundedShardCache(this.capacity);
  }

  async publish(generation: ProjectionGeneration, review: ReviewReadModel): Promise<void> {
    await this.publications.run(() => this.commitPublication(generation, review));
  }

  private async commitPublication(
    generation: ProjectionGeneration,
    review: ReviewReadModel,
  ): Promise<void> {
    await commitMaterializedPublication(
      this.documents,
      generation,
      review,
      this.shardCache,
      this.capacity,
      this.pinned,
    );
  }

  async load(generationId: string): Promise<ProjectionGeneration> {
    return this.withReadLease(generationId, async () => {
      const header = await this.loadHeader(generationId);
      const descriptors = await loadAllDescriptors(this.documents, generationId, header.directory);
      const planCaches = await this.loadPlanCaches(generationId, header);
      const origin = await loadMaterializedProjection(
        header.origin,
        descriptors.filter((descriptor) => descriptor.view === "origin"),
        (descriptor) => this.loadShard(generationId, descriptor),
      );
      const review = await loadMaterializedProjection(
        header.review,
        descriptors.filter((descriptor) => descriptor.view === "review"),
        (descriptor) => this.loadShard(generationId, descriptor),
      );
      return {
        identity: header.identity,
        origin,
        review,
        planCaches,
      };
    });
  }

  async identity(generationId: string) {
    return this.withReadLease(
      generationId,
      async () => (await this.loadHeader(generationId)).identity,
    );
  }

  async reviewScopes(generationId: string, after: string | null, limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Review page limit must be between 1 and 100");
    }
    return this.withReadLease(generationId, async () => {
      const header = await this.loadHeader(generationId);
      const page = await loadPageDescriptors(
        this.documents,
        generationId,
        "review",
        "reviewScopes",
        directoryRoot(header, "review", "reviewScopes"),
        after,
        limit,
      );
      const scopes = [];
      for (const descriptor of page.descriptors) {
        scopes.push({
          identity: descriptor.identity,
          contributionIds: (await this.loadShard(generationId, descriptor)) as readonly string[],
        });
      }
      return {
        identity: header.identity,
        scopes,
        next: page.hasMore ? (scopes.at(-1)?.identity ?? null) : null,
      };
    });
  }

  async reviewSupport(generationId: string, contributionIds: readonly string[]) {
    return this.withReadLease(generationId, async () => {
      const header = await this.loadHeader(generationId);
      const descriptors = await loadExactDescriptors(
        this.documents,
        generationId,
        "review",
        "reviewSupport",
        contributionIds,
        directoryRoot(header, "review", "reviewSupport"),
      );
      const entries = [];
      for (const descriptor of descriptors) {
        entries.push({
          identity: descriptor.identity,
          supportIds: (await this.loadShard(generationId, descriptor)) as readonly string[],
        });
      }
      return { identity: header.identity, entries };
    });
  }

  async page(generationId: string, query: ProjectionQuery): Promise<ProjectionPage> {
    const limit = query.limit ?? 100;
    const section = query.section ?? "nodes";
    const after = query.after ?? null;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Projection page limit must be between 1 and 100");
    }
    return this.withReadLease(generationId, async () => {
      const header = await this.loadHeader(generationId);
      const page = await loadPageDescriptors(
        this.documents,
        generationId,
        query.view,
        section,
        directoryRoot(header, query.view, section),
        after,
        limit,
      );
      const selected = page.descriptors;
      const entries = [];
      for (const descriptor of selected) {
        entries.push({
          identity: descriptor.identity,
          value: await this.loadShard(generationId, descriptor),
        });
      }
      return projectionPage(
        header.identity,
        query.view,
        section,
        page.hasMore ? (selected.at(-1)?.identity ?? null) : null,
        entries,
      );
    });
  }

  async schemaSearch(
    generationId: string,
    view: "origin" | "review",
    schemaId: string,
    after: string | null,
    limit: number,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 99) {
      throw new Error("Schema Search page limit must be between 1 and 99");
    }
    return this.withReadLease(generationId, async () => {
      const header = await this.loadHeader(generationId);
      const result = await readSchemaSearchPage(
        this.documents,
        generationId,
        view,
        schemaId,
        after,
        limit,
        header,
        (descriptor) => this.loadShard(generationId, descriptor),
      );
      return result;
    });
  }

  async read<Section extends ProjectionSliceName>(
    generationId: string,
    view: "origin" | "review",
    section: Section,
    identities: readonly string[],
  ): Promise<ProjectionShardBatch<Section>> {
    return this.withReadLease(generationId, async () => {
      const header = await this.loadHeader(generationId);
      const descriptors = await loadExactDescriptors(
        this.documents,
        generationId,
        view,
        section,
        identities,
        directoryRoot(header, view, section),
      );
      const entries: Readonly<{
        identity: string;
        value: ProjectionSliceValue<Section>;
      }>[] = [];
      for (const descriptor of descriptors) {
        entries.push({
          identity: descriptor.identity,
          value: (await this.loadShard(generationId, {
            ...descriptor,
            section,
          })) as ProjectionSliceValue<Section>,
        });
      }
      return { identity: header.identity, entries };
    });
  }

  async withReadLease<T>(generationId: string, read: () => Promise<T>): Promise<T> {
    const release = this.pin(generationId);
    try {
      return await read();
    } finally {
      release();
      if (!this.pinned.has(generationId)) {
        try {
          const manifest = await loadGenerationManifest(this.documents);
          await cleanupMaterializedGenerations(
            this.documents,
            manifest.generationIds,
            this.pinned,
            false,
          );
        } catch {
          // Publication retries cleanup; a read result never depends on cleanup succeeding.
        }
      }
    }
  }

  private async loadShard(generationId: string, descriptor: ShardDescriptor): Promise<unknown> {
    const cached = this.shardCache.get<unknown>(generationId, descriptor.key);
    if (cached.hit) {
      return cached.value;
    }
    const stored = await loadMaterializedSnapshot(this.documents, descriptor.documentId);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(stored));
    if (!isStoredShard(parsed, generationId, descriptor)) {
      throw new Error("Published Projection shard is corrupt");
    }
    this.shardCache.set(descriptor.key, generationId, parsed.value);
    return parsed.value;
  }

  private async loadHeader(generationId: string): Promise<GenerationHeader> {
    const stored = await loadMaterializedSnapshot(this.documents, headerDocumentId(generationId));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(stored));
    if (!isGenerationHeader(parsed, generationId)) {
      throw new Error("Published Projection Generation header is corrupt");
    }
    return parsed;
  }

  private async loadPlanCaches(
    generationId: string,
    header: GenerationHeader,
  ): Promise<ProjectionGeneration["planCaches"]> {
    const stored = await loadMaterializedSnapshot(this.documents, header.planCache.documentId);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(stored));
    if (!isStoredPlanCaches(parsed, generationId, header.planCache.contentDigest)) {
      throw new Error("Published Projection plan cache is corrupt");
    }
    return parsed.value;
  }

  private readonly pinned = new Map<string, number>();

  private pin(generationId: string): () => void {
    this.pinned.set(generationId, (this.pinned.get(generationId) ?? 0) + 1);
    return () => {
      const count = (this.pinned.get(generationId) ?? 1) - 1;
      if (count === 0) {
        this.pinned.delete(generationId);
      } else {
        this.pinned.set(generationId, count);
      }
    };
  }
}
