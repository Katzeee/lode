import { Engine } from "../../src/core/engine.js";
import { ShardedBlockStore, type Outliner } from "../../src/core/store/sharded-store.js";
import type { SyncableDoc } from "../../src/core/store/syncable.js";
import { InMemoryDocStore, type LoadedDocBytes } from "../../src/core/index.js";
import { toJSON } from "../../src/core/serialize.js";
import type { DocSnapshot } from "../../src/core/types.js";
import { validateSnapshot } from "../../src/core/invariant.js";
import { syncPair } from "../../src/runtime/sync/sync-manager.js";
import { stableStringify } from "../truth-model.js";

/**
 * Shared sync-test harness. Ports the prototype simulator (cloneReplica/syncAll) + the
 * occId-normalized comparator (from tests/editing.test.ts) to the PRODUCTION surface
 * (Engine + ShardedBlockStore + SyncManager). Live Loro occurrence ids churn across
 * replicas/recreate, but the permanent occId is minted into the CRDT bytes and survives —
 * so two converged replicas project to identical canonical strings.
 */

export type { DocSnapshot };

/** A tight shard-cache capacity so convergence/chaos exercise eviction (fault→evict→re-fault)
 *  during sync — verifies the buffer pool is transparent to CRDT convergence. */
const SYNC_TEST_SHARD_CAPACITY = 2;

export function replica(numShards = 8): Engine {
  return new Engine({
    store: new ShardedBlockStore({ numShards, capacity: SYNC_TEST_SHARD_CAPACITY }),
  });
}

/** Seed a fresh engine from snapshots of src (tree + every shard) via the `SyncableDoc` surface —
 *  no raw `LoroDoc` reach. The snapshot bytes carry the full CRDT history, so the clone converges
 *  identically with src after sync. */
export async function cloneReplica(src: Engine): Promise<Engine> {
  // Clone needs the sharding config (numShards), so reach the concrete impl — test-only cast;
  // src is always a ShardedBlockStore. In-memory clone: tree eager + shards seeded into an
  // InMemoryDocStore (the clone faults lazily from it).
  const s = src.asOutliner() as ShardedBlockStore;
  const treeBytes: LoadedDocBytes = {
    snapshot: await s.treeSyncDoc().exportSnapshot(),
    updates: [],
  };
  const shardSeed = new Map<string, LoadedDocBytes>();
  for (const d of s.shardSyncDocs()) {
    shardSeed.set(d.id, {
      snapshot: await d.exportSnapshot(),
      updates: [],
    });
  }
  const dst = new ShardedBlockStore({
    numShards: s.numShards,
    treeBytes,
    docStore: new InMemoryDocStore(shardSeed),
    capacity: SYNC_TEST_SHARD_CAPACITY,
  });
  return new Engine({ store: dst });
}

function storeOf(e: Engine): Outliner {
  const s = e.asOutliner();
  if (!s) {
    throw new Error("not a sharded engine");
  }
  return s;
}

/** Fully synchronize a set of replicas: every unordered pair once. CRDT transitivity ⇒ the
 *  whole set converges. Ports the prototype syncAll. */
export async function syncAll(replicas: Engine[]): Promise<void> {
  for (let i = 0; i < replicas.length; i++) {
    const a = replicas[i];
    if (a === undefined) {
      continue;
    }
    for (let j = i + 1; j < replicas.length; j++) {
      const b = replicas[j];
      if (b !== undefined) {
        await syncPair(storeOf(a), storeOf(b));
      }
    }
  }
}

/** occId-keyed canonical projection of a snapshot. */
export function normalizeSnapshot(snap: DocSnapshot): unknown {
  const liveToOcc = new Map(snap.occurrences.map((o) => [o.occurrenceId, o.occId]));
  const occOf = (live: string): string => liveToOcc.get(live) ?? live;
  return {
    entities: snap.entities
      .map((e) => ({
        nodeId: e.nodeId,
        canonicalOccId: occOf(e.canonicalOccurrenceId),
        deltas: e.deltas,
        props: e.props,
        meta: e.meta,
      }))
      .sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)),
    occurrences: snap.occurrences
      .map((o) => ({
        occId: o.occId,
        nodeId: o.nodeId,
        parentOccId: o.parentOccurrenceId ? occOf(o.parentOccurrenceId) : null,
        childOccIds: o.physicalChildOccurrenceIds.map(occOf),
        props: o.occurrenceProps,
        meta: o.occurrenceMeta,
      }))
      .sort((a, b) => (a.occId < b.occId ? -1 : a.occId > b.occId ? 1 : 0)),
    rootOccIds: snap.rootOccurrenceIds.map(occOf),
  };
}

export async function canonical(e: Engine): Promise<string> {
  return stableStringify(normalizeSnapshot(await toJSON(e)));
}

/** Independent witness: the engine satisfies structural invariants right now. */
export async function assertValid(e: Engine, _label = ""): Promise<void> {
  validateSnapshot(await toJSON(e));
}

/** Assert two engines are behaviorally equivalent (valid + occId-normalized equal). */
export async function assertEquiv(a: Engine, b: Engine, label = ""): Promise<void> {
  await assertValid(a, label);
  await assertValid(b, label);
  if ((await canonical(a)) !== (await canonical(b))) {
    throw new Error(`Replicas diverged${label ? ` (${label})` : ""}`);
  }
}

/** Assert all replicas converged to one valid state. */
export async function assertConverged(replicas: Engine[], label = ""): Promise<void> {
  for (const r of replicas) {
    await assertValid(r, label);
  }
  const firstReplica = replicas[0];
  if (firstReplica === undefined) {
    throw new Error(`assertConverged requires at least one replica${label ? ` (${label})` : ""}`);
  }
  const first = await canonical(firstReplica);
  for (let i = 1; i < replicas.length; i++) {
    const r = replicas[i];
    if (r !== undefined && (await canonical(r)) !== first) {
      throw new Error(`Replica ${i} diverged${label ? ` (${label})` : ""}`);
    }
  }
}

// ── chaos primitives (port of the prototype simulator's partial-delivery shapes) ──────────

function docOf(e: Engine, id: string): SyncableDoc | undefined {
  return e
    .asOutliner()
    ?.docs()
    .find((d) => d.id === id);
}

async function twoWaySyncDoc(da: SyncableDoc, db: SyncableDoc): Promise<void> {
  const va = await da.version();
  const vb = await db.version();
  const aToB = await da.exportUpdate(vb);
  const bToA = await db.exportUpdate(va);
  await da.importUpdate(bToA);
  await db.importUpdate(aToB);
}

/** Sync ONLY the treeDoc between two replicas; content shards stay undelivered.
 *  Models a mid-sync or partitioned-shard state. The treeDoc is the composite's first doc. */
export async function syncTreeOnly(a: Engine, b: Engine): Promise<void> {
  const treeId = storeOf(a).treeSyncDoc().id;
  if (!treeId) {
    return;
  }
  const da = docOf(a, treeId);
  const db = docOf(b, treeId);
  if (da && db) {
    await twoWaySyncDoc(da, db);
  }
}
