import type { ProjectionPage, ProjectionQuery } from "../../application/contract.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import {
  MANIFEST_DOCUMENT_ID,
  MANIFEST_FORMAT,
  cacheKey,
  directoryRoot,
  encodeMaterialized,
  headerDocumentId,
  ownerCacheDocumentId,
  type GenerationHeader,
  type GenerationManifest,
  type ShardDescriptor,
} from "./materialized-generation-format.js";
import { materialize } from "./materialize-generation.js";
import {
  isGenerationHeader,
  isManifest,
  isStoredOwnerCaches,
  isStoredShard,
} from "./materialized-format-validation.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";
import { projectionPageMaps } from "./projection-page.js";
import type {
  BoundedMaterializerOptions,
  MaterializedShard,
} from "./bounded-materializer-types.js";
import { loadMaterializedProjection } from "./materialized-projection-loader.js";
import { SerialExecutor } from "../kernel/serial-executor.js";
import {
  deleteGenerationDocuments,
  deleteOrphanMaterializedDocuments,
  loadAllDescriptors,
  loadExactDescriptors,
  loadPageDescriptors,
  writeDirectoryNodes,
  writeMaterializedEntry,
} from "./materialized-directory.js";

export class BoundedProjectionMaterializer implements ProjectionGenerationStore {
  private readonly capacity: number;
  private generationIdValue: string | null = null;
  private shards = new Map<string, MaterializedShard>();
  private largestPageValue = 0;
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
    const previousManifest = await this.loadManifest();
    try {
      await this.removeUnreferencedGenerations(previousManifest.generationIds);
    } catch {
      // A later successful publication repeats cleanup from the durable manifest.
    }
    const materialized = materialize(generation);
    for (const shard of materialized.shards) {
      await writeMaterializedEntry(this.documents, generation.identity.generationId, shard);
    }
    await writeDirectoryNodes(this.documents, materialized.directoryNodes);
    await this.documents.writeSnapshot(
      ownerCacheDocumentId(generation.identity.generationId),
      encodeMaterialized(materialized.ownerCaches),
    );
    await this.documents.writeSnapshot(
      headerDocumentId(generation.identity.generationId),
      encodeMaterialized(materialized.header),
    );

    const generationIds = [
      ...previousManifest.generationIds.filter(
        (generationId) => generationId !== generation.identity.generationId,
      ),
      generation.identity.generationId,
    ].slice(-2);
    await this.documents.writeSnapshot(
      MANIFEST_DOCUMENT_ID,
      encodeMaterialized({ format: MANIFEST_FORMAT, generationIds } satisfies GenerationManifest),
    );

    this.shards = new Map();
    for (const shard of materialized.shards.slice(0, this.capacity)) {
      this.cache(shard.descriptor.key, generation.identity.generationId, shard.value);
    }
    this.generationIdValue = generation.identity.generationId;
    try {
      await this.removeUnreferencedGenerations(generationIds);
    } catch {
      // The manifest already defines the bounded live set; orphan cleanup is retried by later publishes.
    }
  }

  async load(generationId: string): Promise<ProjectionGeneration> {
    return this.withReadLease(generationId, async () => {
      const header = await this.loadHeader(generationId);
      const descriptors = await loadAllDescriptors(this.documents, generationId, header.directory);
      const ownerCaches = await this.loadOwnerCaches(generationId, header);
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
        ownerCaches,
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

  async read(
    generationId: string,
    view: "origin" | "review",
    section: ShardDescriptor["section"],
    identities: readonly string[],
  ) {
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
          const manifest = await this.loadManifest();
          await this.removeUnreferencedGenerations(manifest.generationIds, false);
        } catch {
          // Publication retries cleanup; a read result never depends on cleanup succeeding.
        }
      }
    }
  }

  generationId(): string | null {
    return this.generationIdValue;
  }

  retainedUnits(): number {
    return this.shards.size;
  }

  largestPageUnits(): number {
    return this.largestPageValue;
  }

  private async loadShard(generationId: string, descriptor: ShardDescriptor): Promise<unknown> {
    const cached = this.shards.get(cacheKey(generationId, descriptor.key));
    if (cached) {
      this.shards.delete(cacheKey(generationId, descriptor.key));
      this.shards.set(cacheKey(generationId, descriptor.key), cached);
      return cached.value;
    }
    const stored = await loadSnapshot(this.documents, descriptor.documentId);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(stored));
    if (!isStoredShard(parsed, generationId, descriptor)) {
      throw new Error("Published Projection shard is corrupt");
    }
    this.cache(descriptor.key, generationId, parsed.value);
    return parsed.value;
  }

  private cache(key: string, generationId: string, value: unknown): void {
    const indexed = cacheKey(generationId, key);
    this.shards.delete(indexed);
    this.shards.set(indexed, { key, generationId, value });
    while (this.shards.size > this.capacity) {
      const oldest = this.shards.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.shards.delete(oldest);
    }
  }

  private async loadHeader(generationId: string): Promise<GenerationHeader> {
    const stored = await loadSnapshot(this.documents, headerDocumentId(generationId));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(stored));
    if (!isGenerationHeader(parsed, generationId)) {
      throw new Error("Published Projection Generation header is corrupt");
    }
    return parsed;
  }

  private async loadOwnerCaches(
    generationId: string,
    header: GenerationHeader,
  ): Promise<ProjectionGeneration["ownerCaches"]> {
    const stored = await loadSnapshot(this.documents, header.ownerCache.documentId);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(stored));
    if (!isStoredOwnerCaches(parsed, generationId, header.ownerCache.contentDigest)) {
      throw new Error("Published Projection owner cache is corrupt");
    }
    return parsed.value;
  }

  private async loadManifest(): Promise<GenerationManifest> {
    const stored = await this.documents.load(MANIFEST_DOCUMENT_ID);
    if (!stored) {
      return { format: MANIFEST_FORMAT, generationIds: [] };
    }
    if (!stored.snapshot || stored.updates.length > 0) {
      throw new Error("Published Projection Generation manifest is corrupt");
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(stored.snapshot));
    if (!isManifest(parsed)) {
      throw new Error("Published Projection Generation manifest is corrupt");
    }
    return parsed;
  }

  private async removeUnreferencedGenerations(
    retainedIds: readonly string[],
    scanOrphanShards = true,
  ): Promise<void> {
    const retained = new Set(retainedIds);
    const headerPrefix = "materialized-generation/header/";
    const headerIds = await this.documents.listIds({ prefix: headerPrefix });
    const storedIds = headerIds.map((id) => id.slice(headerPrefix.length));
    for (const generationId of storedIds.filter(
      (id) => !retained.has(id) && !this.pinned.has(id),
    )) {
      await deleteGenerationDocuments(this.documents, generationId);
    }
    if (this.pinned.size > 0 || !scanOrphanShards) {
      return;
    }
    await deleteOrphanMaterializedDocuments(this.documents, retained);
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

async function loadSnapshot(documents: DocumentStore, id: string): Promise<Uint8Array> {
  const stored = await documents.load(id);
  if (!stored?.snapshot || stored.updates.length > 0) {
    throw new Error("Published Projection Generation is unavailable");
  }
  return stored.snapshot;
}
