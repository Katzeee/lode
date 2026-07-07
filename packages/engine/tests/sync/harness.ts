import { Engine } from "../../src/core/engine.js";
import { ShardedBlockStore, type Outliner } from "../../src/core/sharded-store.js";
import type { SyncableDoc } from "../../src/core/syncable.js";
import type { LoadedDocBytes } from "../../src/core/index.js";
import { toJSON } from "../../src/core/serializers/json.js";
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

export type DocSnapshot = ReturnType<typeof toJSON>;

export function replica(numShards = 8): Engine {
  return new Engine({ store: new ShardedBlockStore({ numShards }) });
}

/** Seed a fresh engine from snapshots of src (tree + every shard) via the `SyncableDoc` surface —
 *  no raw `LoroDoc` reach. The snapshot bytes carry the full CRDT history, so the clone converges
 *  identically with src after sync. */
export function cloneReplica(src: Engine): Engine {
  // Clone needs the sharding config (numShards), so reach the concrete impl — test-only cast;
  // src is always a ShardedBlockStore. The residentBytes map is keyed by outward SyncableDoc ids.
  const s = src.asOutliner() as ShardedBlockStore;
  const residentBytes = new Map<string, LoadedDocBytes>();
  residentBytes.set(s.treeSyncDoc().id, {
    snapshot: s.treeSyncDoc().exportSnapshot(),
    updates: [],
  });
  for (const d of s.shardSyncDocs()) {
    residentBytes.set(d.id, { snapshot: d.exportSnapshot(), updates: [] });
  }
  const dst = new ShardedBlockStore({ numShards: s.numShards, residentBytes });
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

export function canonical(e: Engine): string {
  return stableStringify(normalizeSnapshot(toJSON(e)));
}

/** Independent witness: the engine satisfies structural invariants right now. */
export function assertValid(e: Engine, _label = ""): void {
  validateSnapshot(toJSON(e));
}

/** Assert two engines are behaviorally equivalent (valid + occId-normalized equal). */
export function assertEquiv(a: Engine, b: Engine, label = ""): void {
  assertValid(a, label);
  assertValid(b, label);
  if (canonical(a) !== canonical(b)) {
    throw new Error(`Replicas diverged${label ? ` (${label})` : ""}`);
  }
}

/** Assert all replicas converged to one valid state. */
export function assertConverged(replicas: Engine[], label = ""): void {
  for (const r of replicas) {
    assertValid(r, label);
  }
  const firstReplica = replicas[0];
  if (firstReplica === undefined) {
    throw new Error(`assertConverged requires at least one replica${label ? ` (${label})` : ""}`);
  }
  const first = canonical(firstReplica);
  for (let i = 1; i < replicas.length; i++) {
    const r = replicas[i];
    if (r !== undefined && canonical(r) !== first) {
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

function twoWaySyncDoc(da: SyncableDoc, db: SyncableDoc): void {
  const va = da.version();
  const vb = db.version();
  const aToB = da.exportUpdate(vb);
  const bToA = db.exportUpdate(va);
  da.importUpdate(bToA);
  db.importUpdate(aToB);
}

/** Sync ONLY the treeDoc between two replicas; content shards stay undelivered.
 *  Models a mid-sync or partitioned-shard state. The treeDoc is the composite's first doc. */
export function syncTreeOnly(a: Engine, b: Engine): void {
  const treeId = storeOf(a).treeSyncDoc().id;
  if (!treeId) {
    return;
  }
  const da = docOf(a, treeId);
  const db = docOf(b, treeId);
  if (da && db) {
    twoWaySyncDoc(da, db);
  }
}
