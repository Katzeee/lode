import { LoroDoc } from "loro-crdt";
import type { DocStore } from "../../src/core/store/doc-store.js";
import type { ShardCache } from "../../src/core/store/shard-cache.js";
import type { ShardedBlockStore } from "../../src/core/store/sharded-store.js";
import { SYS_PREFIX, type SyncableDoc } from "../../src/core/store/syncable.js";

export async function readShardDoc(store: ShardedBlockStore, shardId: string): Promise<LoroDoc> {
  const doc = new LoroDoc();
  doc.import(await ownedShard(store, shardId).exportSnapshot());
  return doc;
}

/** White-box observation for cache/healing tests. Kept in test support so raw shard access does not
 * become part of the production store API. The caller must have already faulted the shard. */
export function residentShardDoc(store: ShardedBlockStore, shardId: string): LoroDoc {
  const cache = (
    store as unknown as {
      readonly shardCache: ShardCache<LoroDoc>;
    }
  ).shardCache;
  const doc = cache.residentEntries().find(([id]) => id === shardId)?.[1];
  if (doc === undefined) {
    throw new Error(`shard is not resident: ${shardId}`);
  }
  return doc;
}

export async function snapshotShard(
  store: ShardedBlockStore,
  shardId: string,
): Promise<Uint8Array> {
  return ownedShard(store, shardId).exportSnapshot();
}

export async function mutateShard(
  store: ShardedBlockStore,
  shardId: string,
  mutation: (doc: LoroDoc) => void,
): Promise<void> {
  const syncDoc = ownedShard(store, shardId);
  const doc = await readShardDoc(store, shardId);
  const before = doc.version();
  mutation(doc);
  doc.commit();
  await syncDoc.importUpdate(doc.export({ mode: "update", from: before }));
}

export async function readStoredShard(docStore: DocStore, shardId: string): Promise<LoroDoc> {
  const loaded = await docStore.load(SYS_PREFIX + shardId);
  if (loaded === null) {
    throw new Error(`shard is not stored: ${shardId}`);
  }
  const doc = new LoroDoc();
  if (loaded.snapshot !== null) {
    doc.import(loaded.snapshot);
  }
  for (const update of loaded.updates) {
    doc.import(update);
  }
  return doc;
}

function ownedShard(store: ShardedBlockStore, shardId: string): SyncableDoc {
  const doc = store.shardSyncDocs().find(({ id }) => id === SYS_PREFIX + shardId);
  if (doc === undefined) {
    throw new Error(`shard is not owned: ${shardId}`);
  }
  return doc;
}
