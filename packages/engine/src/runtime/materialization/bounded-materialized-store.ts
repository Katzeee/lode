import type { DocumentStore } from "../../persistence/document-store.js";
import { SerialExecutor } from "../kernel/serial-executor.js";
import { BoundedShardCache } from "./bounded-shard-cache.js";
import type {
  MaterializedDatasetCatalog,
  MaterializedDataset,
  MaterializedDatasetEntry,
} from "./materialized-dataset.js";
import { cleanupMaterializedGenerations } from "./materialized-cleanup.js";
import { loadAllDescriptors, loadExactDescriptors, loadPageDescriptors } from "./materialized-directory.js";
import { loadGenerationManifest, loadMaterializedSnapshot } from "./materialized-document-read.js";
import {
  directoryRoot,
  headerDocumentId,
  type GenerationHeader,
  type ShardDescriptor,
} from "./materialized-generation-format.js";
import { isGenerationHeader, isStoredShard } from "./materialized-format-validation.js";
import { commitMaterializedPublication } from "./materialized-publication.js";

export type LoadedMaterializedEntry<Value = unknown> = Readonly<{
  descriptor: ShardDescriptor;
  value: Value;
}>;

export type MaterializedGenerationRead<Identity> = Readonly<{
  identity: Identity;
  all<Value>(dataset: MaterializedDataset<Value>): Promise<readonly LoadedMaterializedEntry<Value>[]>;
  page<Value>(
    dataset: MaterializedDataset<Value>,
    after: string | null,
    limit: number,
  ): Promise<Readonly<{ entries: readonly LoadedMaterializedEntry<Value>[]; hasMore: boolean }>>;
  exact<Value>(
    dataset: MaterializedDataset<Value>,
    identities: readonly string[],
  ): Promise<readonly LoadedMaterializedEntry<Value>[]>;
}>;

export class BoundedMaterializedStore<Identity extends Readonly<{ generationId: string }>> {
  private readonly shardCache: BoundedShardCache;
  private readonly publications = new SerialExecutor();
  private readonly pinned = new Map<string, number>();

  constructor(
    private readonly documents: DocumentStore,
    private readonly catalog: MaterializedDatasetCatalog<Identity>,
    private readonly capacity: number,
  ) {
    this.shardCache = new BoundedShardCache(capacity);
  }

  async publish(identity: Identity, entries: readonly MaterializedDatasetEntry[]): Promise<void> {
    await this.publications.run(() =>
      commitMaterializedPublication(
        this.documents,
        identity,
        entries,
        this.catalog,
        this.shardCache,
        this.capacity,
        this.pinned,
      ),
    );
  }

  async read<T>(
    generationId: string,
    operation: (generation: MaterializedGenerationRead<Identity>) => Promise<T>,
  ): Promise<T> {
    return this.withLease(generationId, async () => {
      const header = await this.loadHeader(generationId);
      const read: MaterializedGenerationRead<Identity> = {
        identity: header.identity,
        all: async <Value>(dataset: MaterializedDataset<Value>) => {
          const descriptors = await loadAllDescriptors(
            this.documents,
            generationId,
            [directoryRoot(header, dataset.root)],
            this.catalog,
          );
          return this.loadEntries(generationId, descriptors, dataset);
        },
        page: async <Value>(dataset: MaterializedDataset<Value>, after: string | null, limit: number) => {
          if (!Number.isSafeInteger(limit) || limit < 1) {
            throw new Error("Materialized page limit must be a positive safe integer");
          }
          const page = await loadPageDescriptors(
            this.documents,
            generationId,
            dataset.root,
            directoryRoot(header, dataset.root),
            after,
            limit,
            this.catalog,
          );
          return {
            entries: await this.loadEntries(generationId, page.descriptors, dataset),
            hasMore: page.hasMore,
          };
        },
        exact: async <Value>(dataset: MaterializedDataset<Value>, identities: readonly string[]) => {
          const descriptors = await loadExactDescriptors(
            this.documents,
            generationId,
            dataset.root,
            directoryRoot(header, dataset.root),
            identities,
            this.catalog,
          );
          return this.loadEntries(generationId, descriptors, dataset);
        },
      };
      return operation(read);
    });
  }

  private async loadEntries<Value>(
    generationId: string,
    descriptors: readonly ShardDescriptor[],
    dataset: MaterializedDataset<Value>,
  ): Promise<readonly LoadedMaterializedEntry<Value>[]> {
    return Promise.all(
      descriptors.map(async (descriptor) => ({
        descriptor,
        value: await this.loadShard(generationId, descriptor, dataset),
      })),
    );
  }

  private async loadShard<Value>(
    generationId: string,
    descriptor: ShardDescriptor,
    dataset: MaterializedDataset<Value>,
  ): Promise<Value> {
    const cached = this.shardCache.get<Value>(generationId, descriptor.key);
    if (cached.hit) {
      return cached.value;
    }
    const stored = await loadMaterializedSnapshot(this.documents, descriptor.documentId);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(stored));
    if (!isStoredShard(parsed, generationId, descriptor, dataset)) {
      throw new Error("Published materialized dataset shard is corrupt");
    }
    this.shardCache.set(descriptor.key, generationId, parsed.value);
    return parsed.value;
  }

  private async loadHeader(generationId: string): Promise<GenerationHeader<Identity>> {
    const stored = await loadMaterializedSnapshot(this.documents, headerDocumentId(generationId));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(stored));
    if (!isGenerationHeader(parsed, generationId, this.catalog)) {
      throw new Error("Published materialized generation header is corrupt");
    }
    return parsed;
  }

  async withLease<T>(generationId: string, read: () => Promise<T>): Promise<T> {
    const release = this.pin(generationId);
    try {
      return await read();
    } finally {
      release();
      if (!this.pinned.has(generationId)) {
        try {
          const manifest = await loadGenerationManifest(this.documents);
          await cleanupMaterializedGenerations(this.documents, manifest.generationIds, this.pinned, false);
        } catch {
          // Publication retries cleanup; a read result never depends on cleanup succeeding.
        }
      }
    }
  }

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
