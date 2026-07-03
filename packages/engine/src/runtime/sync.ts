import type { ShardedBlockStore, SyncDoc } from "../core/sharded-store.js";
import type { VersionVector } from "../core/types.js";
import { MAIN_SUBDOC } from "../persistence/workspace-store.js";

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
  constructor(
    private readonly store: ShardedBlockStore,
    private readonly transport: SyncTransport,
  ) {}

  async sync(): Promise<void> {
    const remote = new Map((await this.transport.remoteProfile()).map((p) => [p.docId, p.version]));

    // TreeDoc FIRST: it carries ownership, so syncing it reveals which shard ids exist on each
    // side. Exchange both directions in one round.
    const tree = this.localDoc(MAIN_SUBDOC);
    if (tree) {
      await this.exchangeDoc(tree, remote.get(MAIN_SUBDOC));
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
        await this.exchangeDoc(doc, remote.get(sid));
      }
    }

    // Heal cross-doc orphans from concurrent edits across replicas (a ref to X created alongside
    // X's hard-delete). sweepOrphans is ownership-based, so a shard merely pending (not yet
    // delivered) is NOT swept — partial delivery self-heals when the shard arrives.
    this.store.sweepOrphans();
  }

  private localDoc(id: string): SyncDoc | undefined {
    return this.store.syncDocs().find((d) => d.id === id);
  }

  /** Exchange one doc both ways in a round: pull peer→local, push local→peer (captured before
   *  import so the push never echoes the peer's own ops back). */
  private async exchangeDoc(doc: SyncDoc, remoteVV: VersionVector | undefined): Promise<void> {
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
  }
}

/**
 * In-process transport backed by another store directly — the test substrate and the path for two
 * workspaces in one process. `syncPair` runs one round (both directions exchanged) then reconciles
 * both sides — each peer is its own good citizen in production; the helper models that for in-process
 * pairs. The real network transport lives in `@lode/transport` (`BrokerClientSyncTransport`).
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
