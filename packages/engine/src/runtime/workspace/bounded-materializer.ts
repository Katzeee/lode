import type { ProjectionPage, ProjectionQuery } from "../../application/contract.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
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
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";
import { projectionPageMaps } from "./projection-page.js";
import type { BoundedMaterializerOptions } from "./bounded-materializer-types.js";
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

export class BoundedProjectionMaterializer implements ProjectionGenerationStore {
  private readonly capacity: number;
  private generationIdValue: string | null = null;
  private readonly shardCache: BoundedShardCache;
  private largestPageValue = 0;
  private largestExactReadValue = 0;
  private nextPublicationOrdinal = 0;
  private publicationFenceOrdinal = 0;
  private readonly publications = new SerialExecutor();

  constructor(
    private readonly documents: DocumentStore,
    private readonly options: BoundedMaterializerOptions = {},
  ) {
    this.capacity = options.capacity ?? 128;
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1) {
      throw new Error("Materializer capacity must be a positive safe integer");
    }
    this.shardCache = new BoundedShardCache(this.capacity);
  }

  async publish(generation: ProjectionGeneration): Promise<void> {
    const ordinal = ++this.nextPublicationOrdinal;
    await this.options.beforeCommit?.(generation);
    await this.publications.run(() => this.commitPublication(generation, ordinal));
  }

  private async commitPublication(
    generation: ProjectionGeneration,
    ordinal: number,
  ): Promise<void> {
    if (ordinal < this.publicationFenceOrdinal) {
      return;
    }
    this.publicationFenceOrdinal = ordinal;
    await commitMaterializedPublication(
      this.documents,
      generation,
      this.shardCache,
      this.capacity,
      this.pinned,
    );
    this.generationIdValue = generation.identity.generationId;
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

  async planCaches(generationId: string): Promise<ProjectionGeneration["planCaches"]> {
    return this.withReadLease(generationId, async () => {
      const header = await this.loadHeader(generationId);
      return this.loadPlanCaches(generationId, header);
    });
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
      this.largestPageValue = Math.max(this.largestPageValue, scopes.length);
      return {
        identity: header.identity,
        scopes,
        next: page.hasMore ? (scopes.at(-1)?.identity ?? null) : null,
      };
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
      this.largestPageValue = Math.max(this.largestPageValue, selected.length);
      const entries = [];
      for (const descriptor of selected) {
        entries.push({
          identity: descriptor.identity,
          value: await this.loadShard(generationId, descriptor),
        });
      }
      return {
        identity: header.identity,
        view: query.view,
        section,
        entries: entries as ProjectionPage["entries"],
        next: page.hasMore ? (selected.at(-1)?.identity ?? null) : null,
        ...projectionPageMaps(section, entries),
      };
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
      this.largestPageValue = Math.max(this.largestPageValue, result.nodeIds.length);
      return result;
    });
  }

  async read(
    generationId: string,
    view: "origin" | "review",
    section: ShardDescriptor["section"],
    identities: readonly string[],
  ) {
    return this.withReadLease(generationId, async () => {
      this.largestExactReadValue = Math.max(this.largestExactReadValue, identities.length);
      const header = await this.loadHeader(generationId);
      const descriptors = await loadExactDescriptors(
        this.documents,
        generationId,
        view,
        section,
        identities,
        directoryRoot(header, view, section),
      );
      const entries = [];
      for (const descriptor of descriptors) {
        entries.push({
          identity: descriptor.identity,
          value: await this.loadShard(generationId, descriptor),
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

  generationId(): string | null {
    return this.generationIdValue;
  }

  resetReadMetrics(): void {
    this.largestPageValue = 0;
    this.largestExactReadValue = 0;
  }

  retainedUnits(): number {
    return this.shardCache.size();
  }

  largestPageUnits(): number {
    return this.largestPageValue;
  }

  largestExactReadUnits(): number {
    return this.largestExactReadValue;
  }

  private async loadShard(generationId: string, descriptor: ShardDescriptor): Promise<unknown> {
    const cached = this.shardCache.get(generationId, descriptor.key);
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
