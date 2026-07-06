import type { ShardedBlockStore, SyncDoc } from "../../core/sharded-store.js";
import type { VersionVector } from "../../core/types.js";
import { MAIN_SUBDOC } from "../../persistence/workspace-store.js";

/** A peer's per-doc version vectors — the cheap metadata exchanged first to find what differs.
 *  Loro VVs are bounded (Map<peer,count>) and directly comparable, so — unlike any-sync's
 *  unbounded head sets — no bloom-filter diff is needed. */
export type SyncProfile = { docId: string; version: VersionVector }[];

/**
 * The transport seam. Phase B ships an in-memory impl (two stores in one process); Phase D
 * (real network) is a drop-in impl over RPC. The interface deals in docIds + bytes + version
 * vectors only — no LoroDoc crosses it — so it can span a process boundary. (Phase D encodes
 * the VersionVectors at the boundary; the in-memory impl passes them by reference.)
 */
export type SyncTransport = {
  remoteProfile(): Promise<SyncProfile>;
  fetchUpdates(docId: string, from: VersionVector): Promise<Uint8Array>;
  sendUpdates(docId: string, bytes: Uint8Array): Promise<void>;
};

/**
 * Drives one sync round with a peer. TreeDoc first (it carries ownership, so it reveals which
 * shardIds exist), then the UNION of local + remote shard ids (materializing any the treeDoc
 * sync revealed); per doc, pull the peer's ops beyond our VV and push our ops beyond the peer's
 * VV, capturing the push BEFORE importing the pull so we don't echo the peer's own ops back. One
 * round converges a pair (both directions exchanged). Finally `sweepOrphans` heals the
 * cross-doc orphans concurrent edits leave (ownership-based, so a merely-pending shard is not
 * swept). Idempotent + safe to retry.
 */
export class SyncManager {
  /** The peer's last-advertised per-doc VV, captured at the start of each `sync()` round (right after
   *  `remoteProfile`) so `pushOnly()` can export an incremental update without a profile round-trip.
   *  Empty until the first successful round — push no-ops until then; the tick owns cold start.
   *  A possibly-stale cached VV (the cache only advances on a `sync()` profile fetch, not on push) is
   *  safe: `pushOnly` re-sends ops the peer may already have, which Loro's import applies idempotently
   *  (in-version ops are ignored on apply) — redundant bandwidth, never corruption. That property is
   *  load-bearing here; re-verify it on loro-crdt upgrades. */
  private readonly lastRemoteVV = new Map<string, VersionVector>();

  constructor(
    private readonly store: ShardedBlockStore,
    private readonly transport: SyncTransport,
  ) {}

  async sync(): Promise<{ pulled: number; pushed: number }> {
    const remote = new Map((await this.transport.remoteProfile()).map((p) => [p.docId, p.version]));
    // Cache the peer's VVs for `pushOnly` BEFORE the per-doc loop — `sync()` is the only path that
    // learns remote VVs, so caching here means a round that throws partway still leaves push the
    // freshest profile it fetched (rather than never writing it at the end).
    this.lastRemoteVV.clear();
    for (const [docId, vv] of remote) {
      this.lastRemoteVV.set(docId, vv);
    }

    let pulled = 0;
    let pushed = 0;

    // TreeDoc FIRST: it carries ownership, so syncing it reveals which shard ids exist on each
    // side. Exchange both directions in one round.
    const tree = this.localDoc(MAIN_SUBDOC);
    if (tree) {
      const r = await this.exchangeDoc(tree, remote.get(MAIN_SUBDOC));
      pulled += r.pulled ? 1 : 0;
      pushed += r.pushed ? 1 : 0;
    }

    // Shards: the UNION of local + remote ids. Local ids are re-read AFTER the treeDoc sync so
    // shards whose ownership just arrived from the peer are included; a shard the peer has but
    // local hasn't is materialized (getShardDoc), then pulled. Materialize every union id first,
    // then snapshot the local docs as a Map for O(1) lookup during the exchange loop.
    const shardIds = new Set<string>();
    for (const id of this.store.syncDocs().map((d) => d.id)) {
      if (id !== MAIN_SUBDOC) {
        shardIds.add(id);
      }
    }
    for (const id of remote.keys()) {
      if (id !== MAIN_SUBDOC) {
        shardIds.add(id);
      }
    }
    for (const sid of shardIds) {
      this.store.getShardDoc(sid); // materialize shards the now-synced treeDoc revealed
    }
    const local = new Map(this.store.syncDocs().map((d) => [d.id, d]));
    for (const sid of shardIds) {
      const doc = local.get(sid);
      if (doc) {
        const r = await this.exchangeDoc(doc, remote.get(sid));
        pulled += r.pulled ? 1 : 0;
        pushed += r.pushed ? 1 : 0;
      }
    }

    // Heal cross-doc orphans from concurrent edits across replicas (a ref to X created alongside
    // X's hard-delete). sweepOrphans is ownership-based, so a shard merely pending (not yet
    // delivered) is NOT swept — partial delivery self-heals when the shard arrives.
    this.store.sweepOrphans();
    return { pulled, pushed };
  }

  /** Send-only half of a round — the push fast-path, driven on a local mutation (the runner
   *  subscribes to the engine's `nodeUpdated`). Skips the `remoteProfile` round-trip (that is what
   *  `sync()` pays) and exports each local doc against the peer's last-known VV. No-op before the
   *  first round populates `lastRemoteVV` (cold start is `sync()`'s job).
   *
   *  Safe to run concurrently with a `sync()` round and intentionally NOT gated out by one: Loro's
   *  export/import are synchronous WASM (no mid-call interleave in single-threaded JS), and CRDT
   *  import on the receiver is idempotent — so a stale `lastRemoteVV` only re-sends ops the peer
   *  may already have, never corrupts. Gating push out during a round would drop pushes for
   *  mutations that land AFTER the round already captured its push bytes (the round's push is a
   *  frozen snapshot at export time); the small redundant bandwidth from a concurrent push is the
   *  better trade than that latency hole. */
  async pushOnly(): Promise<{ pushed: number }> {
    if (this.lastRemoteVV.size === 0) {
      return { pushed: 0 }; // cold start — wait for the first `sync()` to learn the peer's VVs
    }
    let pushed = 0;
    for (const doc of this.store.syncDocs()) {
      const bytes = doc.exportUpdate(this.lastRemoteVV.get(doc.id));
      if (bytes.length > 0) {
        await this.transport.sendUpdates(doc.id, bytes);
        pushed++;
      }
    }
    return { pushed };
  }

  private localDoc(id: string): SyncDoc | undefined {
    return this.store.syncDocs().find((d) => d.id === id);
  }

  /** Exchange one doc both ways in a round: pull peer→local, push local→peer (captured before
   *  import so the push never echoes the peer's own ops back). Returns whether each side moved
   *  bytes — the runner's round-summary log keys off it. */
  private async exchangeDoc(
    doc: SyncDoc,
    remoteVV: VersionVector | undefined,
  ): Promise<{ pulled: boolean; pushed: boolean }> {
    const localVV = doc.version();
    const pull =
      remoteVV === undefined
        ? new Uint8Array(0)
        : await this.transport.fetchUpdates(doc.id, localVV);
    const push = doc.exportUpdate(remoteVV);
    if (pull.length > 0) {
      doc.importUpdate(pull);
    }
    if (push.length > 0) {
      await this.transport.sendUpdates(doc.id, push);
    }
    return { pulled: pull.length > 0, pushed: push.length > 0 };
  }
}

/**
 * In-process transport backed by another store directly — the test substrate and the path for two
 * workspaces in one process. `syncPair` runs one round (both directions exchanged) then reconciles
 * both sides — each peer is its own good citizen in production; the helper models that for in-process
 * pairs. The real network transport is the engine's `BrokerSyncProtocol` (`runtime/broker/`).
 */
export class InMemorySyncTransport implements SyncTransport {
  constructor(private readonly remote: ShardedBlockStore) {}

  remoteProfile(): Promise<SyncProfile> {
    return Promise.resolve(
      this.remote.syncDocs().map((d) => ({ docId: d.id, version: d.version() })),
    );
  }

  fetchUpdates(docId: string, from: VersionVector): Promise<Uint8Array> {
    const doc = this.remoteDoc(docId);
    return Promise.resolve(doc ? doc.exportUpdate(from) : new Uint8Array(0));
  }

  sendUpdates(docId: string, bytes: Uint8Array): Promise<void> {
    const doc = this.remoteDoc(docId);
    if (doc && bytes.length > 0) {
      doc.importUpdate(bytes);
    }
    return Promise.resolve();
  }

  private remoteDoc(docId: string): SyncDoc | undefined {
    return this.remote.syncDocs().find((d) => d.id === docId);
  }
}

/** Sync two in-process stores to convergence in one round (both directions + both sweeps). */
export async function syncPair(a: ShardedBlockStore, b: ShardedBlockStore): Promise<void> {
  await new SyncManager(a, new InMemorySyncTransport(b)).sync();
  b.sweepOrphans();
}
