import type { SyncBytes, SyncableComposite, SyncableDoc } from "../../core/store/syncable.js";

/** A peer's per-doc versions — the cheap metadata exchanged first to find what differs. Opaque
 *  version bytes per sub-doc id; the CRDT backend is closed behind `SyncableDoc`, so this type (and
 *  the transport below) carries no loro/CRDT type. */
export type SyncProfile = { subDocId: string; version: SyncBytes }[];

/**
 * The transport seam. Phase B shipped an in-memory impl (two composites in one process); the broker
 * impl (`BrokerSyncProtocol`) is the real-network drop-in. The interface deals in sub-doc ids +
 * opaque bytes only — no CRDT type crosses it — so it can span a process boundary.
 */
export type SyncTransport = {
  remoteProfile(): Promise<SyncProfile>;
  fetchUpdates(subDocId: string, from: SyncBytes): Promise<Uint8Array>;
  sendUpdates(subDocId: string, bytes: Uint8Array): Promise<void>;
};

/**
 * Drives one sync round against a `SyncableComposite`. The composite declares its own sync plan
 * (docs in exchange order + a `heal()` hook); this driver is business-agnostic — it does not know
 * about shards, ownership, or tree-first ordering. It exchanges docs in the order `docs()` returns,
 * RE-READING `docs()` after each exchange so a doc revealed by an earlier exchange (the outliner's
 * treeDoc carries ownership, so syncing it reveals which shard ids exist) is picked up. One round
 * converges a pair (both directions exchanged per doc); finally `heal()` reconciles. Idempotent +
 * safe to retry.
 *
 * Per doc: pull the peer's ops beyond our version and push our ops beyond the peer's version,
 * capturing the push BEFORE importing the pull so we don't echo the peer's own ops back.
 */
export class SyncManager {
  /** The peer's last-advertised per-doc version, captured at the start of each `sync()` round (right
   *  after `remoteProfile`) so `pushOnly()` can export an incremental update without a profile
   *  round-trip. Empty until the first successful round — push no-ops until then; the tick owns cold
   *  start. A possibly-stale cached version (the cache only advances on a `sync()` profile fetch,
   *  not on push) is safe: `pushOnly` re-sends ops the peer may already have, which CRDT import
   *  applies idempotently (in-version ops are ignored on apply) — redundant bandwidth, never
   *  corruption. That property is load-bearing here; re-verify it on CRDT-backend upgrades. */
  private readonly lastRemoteVersion = new Map<string, SyncBytes>();
  /** Per-doc incremental-sync cursor (the doc's local revision + the peer's version, both as of the
   *  last successful exchange). A round SKIPS a doc whose revision hasn't advanced (no local push)
   *  AND whose peer version is unchanged (no pull) — so a large doc with a few changes only
   *  fault+exchanges the changed shards, not all of them. The tree (no revision) is always a
   *  candidate. Advanced post-round to capture any revision bumps from imported ops. */
  private readonly lastExchange = new Map<string, { revision: number; peerVersion: SyncBytes }>();

  constructor(
    private readonly composite: SyncableComposite,
    private readonly transport: SyncTransport,
  ) {}

  async sync(): Promise<{ pulled: number; pushed: number; considered: number }> {
    const remote = new Map(
      (await this.transport.remoteProfile()).map((p) => [p.subDocId, p.version]),
    );
    // Cache the peer's versions for `pushOnly` BEFORE the per-doc loop — `sync()` is the only path
    // that learns remote versions, so caching here means a round that throws partway still leaves
    // push the freshest profile it fetched (rather than never writing it at the end).
    this.lastRemoteVersion.clear();
    for (const [id, version] of remote) {
      this.lastRemoteVersion.set(id, version);
    }

    const revisions = this.composite.revisions?.() ?? new Map<string, number>();
    let pulled = 0;
    let pushed = 0;
    let considered = 0;
    const seen = new Set<string>();
    // Post-exchange local version for each EXCHANGED doc — used to set the cursor's peerVersion
    // (after a two-way exchange both sides converge, so the local post-version == the peer's).
    const exchangedVersion = new Map<string, SyncBytes>();
    // Iterate the composite's declared order. `docs()` is re-read after each exchange so docs an
    // earlier exchange revealed (treeDoc → shard ownership) are picked up. Ids are stable, so the
    // `seen` set terminates the loop once every surfaced doc has been considered.
    for (;;) {
      const next = this.composite.docs().find((d) => !seen.has(d.id));
      if (!next) {
        break;
      }
      // Incremental candidate filter: skip a doc neither side changed since the last exchange. The
      // tree (no revision → localRev undefined) is always a candidate; so is any doc on its first
      // exchange (no cursor yet). exportUpdate(peerVersion) still runs on candidates for precise
      // in-version exclusion — this filter only avoids faulting/exchanging unchanged shards.
      const localRev = revisions.get(next.id);
      const last = this.lastExchange.get(next.id);
      const peerVersion = remote.get(next.id);
      const peerChanged =
        last !== undefined &&
        last.peerVersion !== undefined &&
        peerVersion !== undefined &&
        !sameBytes(peerVersion, last.peerVersion);
      const candidate =
        localRev === undefined || // tree / untracked → always exchange
        last === undefined || // first round for this doc
        localRev > last.revision || // local changed (push)
        peerChanged; // peer changed (pull)
      if (candidate) {
        considered++;
        const r = await this.exchangeDoc(next, peerVersion);
        pulled += r.pulled ? 1 : 0;
        pushed += r.pushed ? 1 : 0;
        exchangedVersion.set(next.id, r.version);
      }
      seen.add(next.id);
    }
    // Advance the cursor for every seen doc. For exchanged docs, peerVersion = the post-exchange
    // local version (== peer's post-exchange version after convergence) — NOT the stale pre-exchange
    // remoteProfile (which may predate the peer receiving this doc). For skipped docs, peerVersion =
    // the peer's current version (unchanged, hence skipped). Revisions use the POST-round map so any
    // bump from an imported op is captured.
    const postRevisions = this.composite.revisions?.() ?? new Map<string, number>();
    for (const id of seen) {
      this.lastExchange.set(id, {
        revision: postRevisions.get(id) ?? 0,
        peerVersion: exchangedVersion.get(id) ?? remote.get(id) ?? new Uint8Array(0),
      });
    }

    await this.composite.heal();
    return { pulled, pushed, considered };
  }

  /** Send-only half of a round — the push fast-path, driven on a local mutation (the runner
   *  subscribes to the engine's `nodeUpdated`). Skips the `remoteProfile` round-trip (that is what
   *  `sync()` pays) and exports each local doc against the peer's last-known version. No-op before
   *  the first round populates `lastRemoteVersion` (cold start is `sync()`'s job).
   *
   *  Safe to run concurrently with a `sync()` round and intentionally NOT gated out by one: CRDT
   *  export/import are synchronous (no mid-call interleave in single-threaded JS), and import on the
   *  receiver is idempotent — so a stale `lastRemoteVersion` only re-sends ops the peer may already
   *  have, never corrupts. Gating push out during a round would drop pushes for mutations that land
   *  AFTER the round already captured its push bytes; the small redundant bandwidth from a concurrent
   *  push is the better trade than that latency hole. */
  async pushOnly(): Promise<{ pushed: number }> {
    if (this.lastRemoteVersion.size === 0) {
      return { pushed: 0 }; // cold start — wait for the first `sync()` to learn the peer's versions
    }
    let pushed = 0;
    for (const doc of this.composite.pushDocs()) {
      const bytes = await doc.exportUpdate(this.lastRemoteVersion.get(doc.id));
      if (bytes.length > 0) {
        await this.transport.sendUpdates(doc.id, bytes);
        pushed++;
      }
    }
    return { pushed };
  }

  /** Exchange one doc both ways in a round: pull peer→local, push local→peer (captured before
   *  import so the push never echoes the peer's own ops back). Returns whether each side moved bytes
   *  (the runner's round-summary log keys off it) + the post-exchange local version (which equals
   *  the peer's post-exchange version after convergence — the incremental cursor's peerVersion). */
  private async exchangeDoc(
    doc: SyncableDoc,
    remoteVersion: SyncBytes | undefined,
  ): Promise<{ pulled: boolean; pushed: boolean; version: SyncBytes }> {
    const localVersion = await doc.version();
    const pull =
      remoteVersion === undefined
        ? new Uint8Array(0)
        : await this.transport.fetchUpdates(doc.id, localVersion);
    const push = await doc.exportUpdate(remoteVersion);
    if (pull.length > 0) {
      await doc.importUpdate(pull);
    }
    if (push.length > 0) {
      await this.transport.sendUpdates(doc.id, push);
    }
    // Post-exchange (after importing the pull): both sides have converged, so the local version
    // equals the peer's. This is the cursor's peerVersion for next round's peerChanged check.
    const version = pull.length > 0 ? await doc.version() : localVersion;
    return { pulled: pull.length > 0, pushed: push.length > 0, version };
  }
}

/**
 * In-process transport backed by another composite directly — the test substrate and the path for
 * two workspaces in one process. `syncPair` runs one round (both directions exchanged) then heals
 * both sides — each peer is its own good citizen in production; the helper models that for
 * in-process pairs. The real network transport is the engine's `BrokerSyncProtocol`.
 */
export class InMemorySyncTransport implements SyncTransport {
  constructor(private readonly remote: SyncableComposite) {}

  remoteProfile(): Promise<SyncProfile> {
    return Promise.all(
      this.remote.docs().map(async (d) => ({ subDocId: d.id, version: await d.version() })),
    );
  }

  async fetchUpdates(subDocId: string, from: SyncBytes): Promise<Uint8Array> {
    const doc = this.remoteDoc(subDocId);
    return doc ? await doc.exportUpdate(from) : new Uint8Array(0);
  }

  async sendUpdates(subDocId: string, bytes: Uint8Array): Promise<void> {
    const doc = this.remoteDoc(subDocId);
    if (doc && bytes.length > 0) {
      await doc.importUpdate(bytes);
    }
  }

  private remoteDoc(subDocId: string): SyncableDoc | undefined {
    return this.remote.docs().find((d) => d.id === subDocId);
  }
}

/** Sync two in-process composites to convergence in one round (both directions + both heals). */
export async function syncPair(a: SyncableComposite, b: SyncableComposite): Promise<void> {
  await new SyncManager(a, new InMemorySyncTransport(b)).sync();
  await b.heal();
}

/** Byte equality for the incremental-sync cursor's version comparison (versions from the same peer
 *  encode deterministically, so equal bytes ⇒ equal version ⇒ no peer change). */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) {
    return true;
  }
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
