import type { DocumentStore } from "../../../../persistence/index.js";
import { BoundedShardCache } from "./bounded-shard-cache.js";
import { MaterializedGenerationCorruptError, MaterializedGenerationUnavailableError } from "./errors.js";
import type {
  MaterializedDatasetCatalog,
  MaterializedDataset,
  MaterializedDatasetEntry,
} from "./materialized-dataset.js";
import { loadAllDescriptors, loadExactDescriptors, loadPageDescriptors } from "./materialized-directory.js";
import { loadMaterializedSnapshot } from "./materialized-document-read.js";
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

export type MaterializedGenerationRestore<Value> =
  | Readonly<{ kind: "found"; value: Value }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid"; reason: string }>;

export class BoundedMaterializedStore<Identity extends Readonly<{ generationId: string }>> {
  private readonly shardCache: BoundedShardCache;

  constructor(
    private readonly documents: DocumentStore,
    private readonly catalog: MaterializedDatasetCatalog<Identity>,
    private readonly capacity: number,
  ) {
    this.shardCache = new BoundedShardCache(capacity);
  }

  async publish(identity: Identity, entries: readonly MaterializedDatasetEntry[]): Promise<void> {
    await commitMaterializedPublication(
      this.documents,
      identity,
      entries,
      this.catalog,
      this.shardCache,
      this.capacity,
    );
  }

  async read<T>(
    generationId: string,
    operation: (generation: MaterializedGenerationRead<Identity>) => Promise<T>,
  ): Promise<T> {
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
  }

  async storedIdentities(): Promise<readonly Identity[]> {
    const prefix = "materialized-generation/header/";
    const ids = await this.documents.listIds({ prefix });
    const identities: Identity[] = [];
    for (const id of ids) {
      const generationId = id.slice(prefix.length);
      try {
        identities.push((await this.loadHeader(generationId)).identity);
      } catch (error) {
        if (
          !(error instanceof MaterializedGenerationCorruptError) &&
          !(error instanceof MaterializedGenerationUnavailableError)
        ) {
          throw error;
        }
      }
    }
    return identities;
  }

  async restore<T>(
    generationId: string,
    operation: (generation: MaterializedGenerationRead<Identity>) => Promise<T>,
  ): Promise<MaterializedGenerationRestore<T>> {
    const storedHeader = await this.documents.load(headerDocumentId(generationId));
    if (!storedHeader) {
      return { kind: "missing" };
    }
    try {
      return { kind: "found", value: await this.read(generationId, operation) };
    } catch (error) {
      if (
        error instanceof MaterializedGenerationCorruptError ||
        error instanceof MaterializedGenerationUnavailableError
      ) {
        return { kind: "invalid", reason: error.message };
      }
      throw error;
    }
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
    const parsed = parseMaterialized(stored, "Published materialized dataset shard is corrupt");
    if (!isStoredShard(parsed, generationId, descriptor, dataset)) {
      throw new MaterializedGenerationCorruptError("Published materialized dataset shard is corrupt");
    }
    this.shardCache.set(descriptor.key, generationId, parsed.value);
    return parsed.value;
  }

  private async loadHeader(generationId: string): Promise<GenerationHeader<Identity>> {
    const stored = await loadMaterializedSnapshot(this.documents, headerDocumentId(generationId));
    const parsed = parseMaterialized(stored, "Published materialized generation header is corrupt");
    if (!isGenerationHeader(parsed, generationId, this.catalog)) {
      throw new MaterializedGenerationCorruptError("Published materialized generation header is corrupt");
    }
    return parsed;
  }
}

function parseMaterialized(bytes: Uint8Array, message: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new MaterializedGenerationCorruptError(message, { cause: error });
  }
}
