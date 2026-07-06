import { Engine } from "../../src/core/engine.js";
import { ShardedBlockStore, type SyncDoc } from "../../src/core/sharded-store.js";
import { toJSON } from "../../src/core/serializers/json.js";
import { validateSnapshot } from "../../src/core/invariant.js";
import { syncPair } from "../../src/runtime/sync/sync-manager.js";
import { MAIN_SUBDOC } from "../../src/persistence/workspace-store.js";
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

/** Seed a fresh engine from snapshots of src (treeDoc + every shard). The snapshot bytes carry
 *  the full CRDT history, so the clone converges identically with src after sync. */
export function cloneReplica(src: Engine): Engine {
  const s = src.getShardedStore();
  if (!s) {
    throw new Error("cloneReplica: src is not a sharded engine");
  }
  const dst = new ShardedBlockStore({ numShards: s.numShards });
  dst.treeDoc.import(s.treeDoc.export({ mode: "snapshot" }));
  for (const sid of s.shardIds()) {
    dst.getShardDoc(sid).import(s.getShardDoc(sid).export({ mode: "snapshot" }));
  }
  return new Engine({ store: dst });
}

function storeOf(e: Engine): ShardedBlockStore {
  const s = e.getShardedStore();
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

function docOf(e: Engine, id: string): SyncDoc | undefined {
  return e
    .getShardedStore()
    ?.syncDocs()
    .find((d) => d.id === id);
}

function twoWaySyncDoc(da: SyncDoc, db: SyncDoc): void {
  const va = da.version();
  const vb = db.version();
  const aToB = da.exportUpdate(vb);
  const bToA = db.exportUpdate(va);
  da.importUpdate(bToA);
  db.importUpdate(aToB);
}

/** Sync ONLY the treeDoc ("main") between two replicas; content shards stay undelivered.
 *  Models a mid-sync or partitioned-shard state. */
export function syncTreeOnly(a: Engine, b: Engine): void {
  const da = docOf(a, MAIN_SUBDOC);
  const db = docOf(b, MAIN_SUBDOC);
  if (da && db) {
    twoWaySyncDoc(da, db);
  }
}
