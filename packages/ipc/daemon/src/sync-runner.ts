import {
  MEMBERSHIP_DOC_ID,
  MembershipSync,
  SyncManager,
  createMembershipWireSecurity,
  type AppRuntime,
  type ActorKeypair,
  type Component,
  type MembershipLog,
  type MembershipWireSecurity,
  type ShardedBlockStore,
  type SyncDoc,
} from "@lode/engine";
import { BrokerClientSyncTransport } from "@lode/transport";

export type DaemonSyncRunnerOptions = {
  readonly workspaces: AppRuntime["workspaces"];
  /** Round interval; default 20000ms (20s — the reconciliation backstop, anytype-aligned). */
  readonly intervalMs?: number;
};

/** What `shareWorkspace` hands a joiner: where to dial + which broker channel. (The workspace's
 *  single content doc is auto-created at `createWorkspace`, so the joiner needs no doc id — CRDT sync
 *  targets it implicitly.) */
export type WorkspaceCoordinateData = {
  readonly relayUrl: string;
  readonly workspaceId: string;
};

type Wired = {
  readonly transport: BrokerClientSyncTransport;
  readonly sync: SyncManager; // content docs (sealed)
  readonly membershipSync: MembershipSync; // the membership doc (plaintext)
  readonly sec: MembershipWireSecurity;
  readonly log: MembershipLog;
  readonly membershipDoc: SyncDoc; // the membership SyncDoc (engine-owned); directed-fetch target
};

/**
 * Drives secured CRDT sync rounds for registered workspaces over a relay. The runner has NO identity
 * of its own — each syncing workspace is registered by a session (`RegisterSync` / `JoinWorkspace`),
 * which captures that session's actor keypair so the tick keeps signing even after the client
 * disconnects. An App `Component`.
 *
 * Each round: the membership log rides the broker's plaintext envelope (`MembershipSync` gossip),
 * `sec.refresh()` installs the live transit key + member set, then the content `SyncManager.sync()`
 * runs sealed — only once the local actor is a member (before the log converges it isn't, so content
 * is skipped, not errored; the membership round is what lets it join).
 *
 * The membership root is NOT bootstrapped here — `createWorkspace` owns ACL-at-birth (creator = owner,
 * signed with the session actor's keypair). The runner syncs whatever the engine's membership log
 * holds: the owner's pre-rooted log for a creator, or an empty log that converges the owner's root
 * for a joiner.
 *
 * Host glue: composes the engine's per-workspace `ShardedBlockStore` + `MembershipLog` (peek-only via
 * `loadedEngine()` / `membershipLog()`) with `@lode/transport`'s broker transport and the engine's
 * `SyncManager`/`MembershipSync`. It lives in the daemon (the desktop host); mobile composes the same
 * pieces in-process.
 */
export class DaemonSyncRunner implements Component {
  readonly name = "sync-runner";
  private readonly intervalMs: number;
  private readonly wired = new Map<string, Wired>();
  /** Registered workspaces → the session-actor keypair captured at register/join time. The runner has
   *  no identity of its own; this is how it signs per-workspace. */
  private readonly registrations = new Map<string, ActorKeypair>();
  /** The relay URL. Undefined until the first registration. One relay per daemon (MVP): a registration
   *  for a different relay throws. */
  private url: string | undefined;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopped = false;

  constructor(private readonly opts: DaemonSyncRunnerOptions) {
    this.intervalMs = opts.intervalMs ?? 20000;
  }

  /** Wire any already-open registered workspaces, then drive a round every `intervalMs`. */
  async start(): Promise<void> {
    await this.materialize();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.busy || this.stopped) {
      return; // skip overlapping rounds (a round may exceed the interval)
    }
    this.busy = true;
    try {
      await this.materialize();
      for (const w of this.wired.values()) {
        await this.roundWorkspace(w);
      }
    } catch {
      // A round may fail transiently (relay blip, a peer mid-restart, a content round whose peer
      // hasn't converged membership yet). Never abort the driver — the next round retries.
    } finally {
      this.busy = false;
    }
  }

  /** One round for a single workspace: membership gossip → persist → refresh the wire security →
   *  sealed content (only once the local actor is a member). Shared by the periodic `tick` and the
   *  manual `syncNow`. */
  private async roundWorkspace(w: Wired): Promise<void> {
    await w.membershipSync.sync();
    await w.log.persistIfDirty();
    w.sec.refresh();
    if (w.sec.isMember()) {
      await w.sync.sync();
    }
  }

  /** Run one round for `wsId` now instead of waiting for the next tick — `lode sync now`. Same `busy`
   *  overlap guard as the tick: if a round is already running this is a no-op (that round covers it).
   *  Throws on usage errors (stopped / not registered); a registered-but-not-yet-wired workspace is a
   *  best-effort no-op — `materialize` retries wiring on the next tick. Transient round failures are
   *  swallowed exactly as in `tick`. */
  async syncNow(wsId: string): Promise<void> {
    if (this.stopped) {
      throw new Error("sync runner stopped");
    }
    if (!this.registrations.has(wsId)) {
      throw new Error(`syncNow: workspace ${wsId} is not registered for sync`);
    }
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      await this.materialize();
      const w = this.wired.get(wsId);
      if (w) {
        await this.roundWorkspace(w);
      }
    } catch {
      // transient (relay blip, peer mid-restart) — never throw to the caller, same as tick
    } finally {
      this.busy = false;
    }
  }

  /** Serialize materialize so concurrent callers (the tick loop + `registerSync`)
   *  never double-build a workspace — two transports for one workspace leaks one + breaks
   *  convergence. Each call runs the body after any in-flight one resolves. */
  private materializeChain: Promise<void> = Promise.resolve();
  private materialize(): Promise<void> {
    const run = () => this.doMaterialize();
    // `doMaterialize` catches per-workspace and never throws up (see below), so a rejection handler
    // is unnecessary — `.then(run)` suffices.
    this.materializeChain = this.materializeChain.then(run);
    return this.materializeChain;
  }

  /** Build a secured transport for any registered workspace that's now open but not yet wired. Uses
   *  the peek-only `loadedEngine`/`membershipLog` (NOT the load path) so attaching here never races
   *  with the doc-adding load — a workspace is wired only once it's already open with its doc. No-op
   *  until a relay URL is set (before the first registration). */
  private async doMaterialize(): Promise<void> {
    const url = this.url;
    if (url === undefined) {
      return;
    }
    for (const wsId of this.registrations.keys()) {
      if (this.wired.has(wsId)) {
        continue;
      }
      const store = this.opts.workspaces.loadedEngine(wsId)?.getShardedStore() ?? null;
      if (!store) {
        continue; // workspace not open yet — retry next tick
      }
      // Catch per-workspace so one failing wire (transient relay/store error) never throws up to
      // the materialize caller — skip it this round, retry next. Keeps the chain on its success
      // path (see materialize()).
      try {
        const wired = await this.build(wsId, store, url);
        if (this.stopped) {
          wired.transport.close(); // stop() ran while open() was in flight — don't leak the transport.
          return;
        }
        this.wired.set(wsId, wired);
      } catch {
        // skip this workspace this round — retry on the next tick
      }
    }
  }

  private async build(wsId: string, store: ShardedBlockStore, url: string): Promise<Wired> {
    const keypair = this.registrations.get(wsId);
    if (keypair === undefined) {
      throw new Error(`build: no actor registered for ${wsId}`);
    }
    // The engine owns the membership log (created + rooted at createWorkspace). Peek it — never
    // construct or bootstrap here.
    const log = this.opts.workspaces.membershipLog(wsId);
    if (!log) {
      throw new Error(`build: no membership log for ${wsId} (workspace not loaded)`);
    }
    const sec = createMembershipWireSecurity({ log, keypair });
    sec.refresh();
    const membershipDoc = log.toSyncDoc();
    const peerId = this.opts.workspaces.peerId;
    const transport = new BrokerClientSyncTransport({
      url,
      store,
      workspaceId: wsId,
      security: sec.security,
      // The membership doc rides the plaintext envelope (a public roster) AND is served on push-apply.
      publicDocs: () => [membershipDoc],
      // Declare this replica's site id so it's a directed target + discoverable via peers().
      ...(peerId === undefined ? {} : { peerId: String(peerId) }),
    });
    await transport.open();
    return {
      transport,
      sync: new SyncManager(store, transport),
      membershipSync: new MembershipSync(transport, membershipDoc),
      sec,
      log,
      membershipDoc,
    };
  }

  /** Register the session's actor to drive sync for `wsId` via `relayUrl`. Captures the keypair so the
   *  tick runs while the client is disconnected. One workspace → one registrant (its owner): a second,
   *  *different* actor re-registering is refused (it would overwrite the captured keypair that signs
   *  tick rounds + wires transport security); the same actor re-registering (e.g. a second client with
   *  the same identity) is idempotent. One relay per daemon (MVP). Membership governance (`addMember`)
   *  is NOT routed through here — it writes the membership log directly, relay-independent. */
  async registerSync(wsId: string, relayUrl: string, keypair: ActorKeypair): Promise<void> {
    if (this.stopped) {
      throw new Error("sync runner stopped");
    }
    const existing = this.registrations.get(wsId);
    if (existing !== undefined && existing.actorId !== keypair.actorId) {
      throw new Error(
        `registerSync: workspace ${wsId} is already registered by actor ${existing.actorId}`,
      );
    }
    if (this.url === undefined) {
      this.url = relayUrl;
    } else if (this.url !== relayUrl) {
      throw new Error(`already syncing a different relay: ${this.url} (requested ${relayUrl})`);
    }
    this.registrations.set(wsId, keypair);
    await this.materialize(); // url is set + workspace may be open → wire it now
  }

  /** The coordinate an owner hands a joiner: where to dial + the broker channel (workspace id). The
   *  content doc is implicit — `createWorkspace` auto-inits it, so CRDT sync has a target without the
   *  coordinate carrying a doc id. */
  shareCoordinate(wsId: string): WorkspaceCoordinateData {
    if (this.url === undefined) {
      throw new Error("share: not synced to a relay");
    }
    return { relayUrl: this.url, workspaceId: wsId };
  }

  /** Member side: ensure `wsId` exists locally (createWorkspace auto-inits its content doc, so the
   *  owner's content converges into it), register the session actor, then run an immediate round — a
   *  directed membership fetch (transit key installs now) + a fire-and-forget content round — so the
   *  default share→join flow converges instantly, not on the next tick. No membership root (the joiner
   *  isn't the owner; the owner's root converges via sync). One relay per daemon. Idempotent. */
  async joinWorkspace(wsId: string, url: string, keypair: ActorKeypair): Promise<void> {
    if (this.stopped) {
      throw new Error("sync runner stopped");
    }
    // Ensure the workspace exists locally so CRDT sync has a target. createWorkspace auto-inits the
    // content doc; no actorKeypair → no membership root (the owner's root converges via sync).
    if (!(await this.opts.workspaces.getEngine(wsId))) {
      await this.opts.workspaces.createWorkspace({ workspaceId: wsId, displayName: wsId });
    }
    await this.registerSync(wsId, url, keypair);
    // Cold-start: directed-fetch the membership roster from a peer (§3c) so the transit key installs
    // NOW, not on the next broadcast tick. Best-effort — a timeout/empty channel falls back to the tick.
    await this.directedMembershipFetch(wsId);
    // Stage C: fire-and-forget a content round so a joiner (transit key just installed) pulls content
    // now, not on the next tick. Best-effort: syncNow swallows transient round failures internally;
    // .catch defuses the stop()/not-registered race (the only throws left). The tick backstops any
    // peer-offline / raced case this single round doesn't close.
    void this.syncNow(wsId).catch(() => {});
  }

  /** One-shot directed membership fetch (§3c). Asks ONE peer (by peerId) for the full membership doc,
   *  imports it, and refreshes the wire security so `isMember()` flips immediately. Best-effort: any
   *  failure (not wired, no other peer, timeout) is swallowed — the broadcast tick is the backstop. */
  private async directedMembershipFetch(wsId: string): Promise<void> {
    const w = this.wired.get(wsId);
    if (!w) {
      return; // not wired yet — the tick will converge membership via broadcast
    }
    try {
      const self = this.opts.workspaces.peerId;
      const selfPeerId = self === undefined ? undefined : String(self);
      const peers = await w.transport.peers();
      const target = peers.find((p) => p !== selfPeerId && p !== "");
      if (target === undefined) {
        return; // no other peer on the channel yet — wait for the broadcast round
      }
      const bytes = await w.transport.directedFetchUpdates(
        MEMBERSHIP_DOC_ID,
        w.membershipDoc.version(), // the joiner's current membership version (empty → full doc)
        target,
      );
      if (bytes.length > 0) {
        w.membershipDoc.importUpdate(bytes);
        await w.log.persistIfDirty();
        w.sec.refresh();
      }
    } catch {
      // Transient (peer mid-restart, relay blip, timeout) — the next broadcast tick retries.
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    for (const w of this.wired.values()) {
      w.transport.close();
    }
    this.wired.clear();
    this.registrations.clear();
    this.url = undefined;
  }
}
