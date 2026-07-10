import { createLogger } from "@lode/logger";
import { MEMBERSHIP_DOC_ID } from "../membership/membership-log.js";
import { PreconditionFailedError } from "../../errors/index.js";
import type { WorkspaceRegistry } from "../workspace/registry.js";
import type { ActorKeypair } from "../../crypto/index.js";
import type { Engine } from "../../core/engine.js";
import { ChildLifecycleComponent, type Lifecycle, type Component } from "../lifecycle.js";
import { SyncContext } from "./context.js";
import { MembershipRound, ContentRound } from "./round.js";
import { SyncRoundDriver } from "./driver.js";
import { PushFastPath } from "./push.js";
import type { RoundSummary, SyncDeps } from "./deps.js";

const log = createLogger("sync.registry");

/** Wire-poll cadence — the lazy-wire + re-wire-on-reload backstop. registerSync wires immediately
 *  when the workspace is loaded, so this only covers register-before-load and engine reload. */
const WIRE_POLL_MS = 2000;
/** Rate-limit for idle round-summary logs (~every 10th 20s tick). Rounds that exchange ops always log. */
const NO_OP_LOG_INTERVAL_MS = 200_000;
const DEFAULT_ROUND_INTERVAL_MS = 20_000;

/** What `shareCoordinate` hands a joiner: where to dial + which broker channel. The workspace's
 *  single content doc is auto-created at `createWorkspace`, so the joiner needs no doc id. */
export type WorkspaceCoordinateData = {
  readonly relayUrl: string;
  readonly workspaceId: string;
};

type SyncAppHandle = {
  /** The sync sub-graph ChildApp (a child of the workspace's ChildApp). Stopped with the workspace
   *  via the ChildLifecycleComponent holder — so removeWorkspace's app.stop() tears engine+store+sync. */
  readonly syncApp: Lifecycle;
  /** The engine this handle wired against — compared in `ensureWired` to detect a reload + re-wire. */
  readonly engine: Engine;
  readonly ctx: SyncContext;
  readonly driver: SyncRoundDriver;
};

export type SyncRegistryOptions = {
  readonly workspaces: WorkspaceRegistry;
  readonly deps?: SyncDeps;
  readonly roundIntervalMs?: number;
};

/**
 * The cross-workspace coordinator for secured CRDT sync — the engine-owned successor to the old
 * daemon-side `DaemonSyncRunner`. Owns what that runner owned: the per-workspace actor registrations
 * (wsId → keypair, captured at register/join so the tick keeps signing after the client disconnects),
 * the single relay URL (one relay per daemon in the MVP), and the per-workspace sync sub-graphs.
 *
 * Each syncing workspace's sub-graph (context + round driver + push path) is a ChildApp nested under
 * THAT workspace's ChildApp, linked by a ChildLifecycleComponent holder — so `removeWorkspace`'s
 * `app.stop()` tears engine + store + sync down in ONE graph (no leaked transport/tick against a
 * disposed engine). This registry does NOT own the sub-graph lifecycle: it builds it onto the
 * workspace's Lifecycle and lets the workspace's teardown collapse it. `run(signal)` is the lazy-wire +
 * re-wire-on-reload backstop; registerSync wires immediately when the workspace is already loaded, so
 * the poll only covers register-before-load and remove→reopen.
 *
 * The runner has NO identity of its own — every syncing workspace is registered by a session that
 * captures that session's actor keypair. The membership root is NOT bootstrapped here
 * (`createWorkspace` owns ACL-at-birth); this registry syncs whatever the engine's membership log
 * holds.
 */
export class SyncRegistry implements Component {
  readonly name = "sync.registry";
  private readonly workspaces: WorkspaceRegistry;
  private readonly roundIntervalMs: number;
  private readonly report: (wsId: string, summary: RoundSummary) => void;
  private readonly registrations = new Map<string, ActorKeypair>();
  private readonly syncApps = new Map<string, SyncAppHandle>();
  /** Per-workspace idle-log rate-limit state — lives on the registry (not in the reporter closure)
   *  so a workspace's death can purge it. Unused when a custom `onRound` is supplied. */
  private readonly lastNoOp = new Map<string, number>();
  private url?: string;
  private stopped = false;

  constructor(opts: SyncRegistryOptions) {
    this.workspaces = opts.workspaces;
    this.roundIntervalMs = opts.roundIntervalMs ?? DEFAULT_ROUND_INTERVAL_MS;
    this.report = opts.deps?.onRound ?? defaultRoundReporter(this.lastNoOp);
  }

  /** Register the session's actor to drive sync for `wsId` via `relayUrl`. Captures the keypair so
   *  rounds keep signing while the client is disconnected. One workspace → one registrant (its
   *  owner): a second, *different* actor re-registering is refused (it would overwrite the keypair
   *  that signs rounds + wires security); the same actor re-registering is idempotent. One relay per
   *  daemon (MVP). Membership governance (`addMember`) is NOT routed through here — it writes the
   *  membership log directly, relay-independent. */
  async registerSync(wsId: string, relayUrl: string, keypair: ActorKeypair): Promise<void> {
    if (this.stopped) {
      throw new PreconditionFailedError("sync registry stopped");
    }
    const existing = this.registrations.get(wsId);
    if (existing !== undefined && existing.actorId !== keypair.actorId) {
      throw new PreconditionFailedError(
        `registerSync: workspace ${wsId} is already registered by actor ${existing.actorId}`,
      );
    }
    if (this.url === undefined) {
      this.url = relayUrl;
    } else if (this.url !== relayUrl) {
      throw new PreconditionFailedError(
        `already syncing a different relay: ${this.url} (requested ${relayUrl})`,
      );
    }
    this.registrations.set(wsId, keypair);
    await this.ensureWired(wsId); // url is set + workspace may be loaded → wire it now
  }

  /** The coordinate an owner hands a joiner: where to dial + the broker channel. The content doc is
   *  implicit (auto-initialized at createWorkspace). */
  shareCoordinate(wsId: string): WorkspaceCoordinateData {
    if (this.url === undefined) {
      throw new PreconditionFailedError("share: not synced to a relay");
    }
    return { relayUrl: this.url, workspaceId: wsId };
  }

  /** Member side: ensure `wsId` exists locally (createWorkspace auto-inits its content doc, so the
   *  owner's content converges into it), register the session actor, then run an immediate round — a
   *  directed membership fetch (transit key installs now) + a fire-and-forget content round — so the
   *  default share→join flow converges instantly, not on the next tick. No membership root (the
   *  joiner isn't the owner; the owner's root converges via sync). One relay per daemon. Idempotent. */
  async joinWorkspace(wsId: string, url: string, keypair: ActorKeypair): Promise<void> {
    if (this.stopped) {
      throw new PreconditionFailedError("sync registry stopped");
    }
    // Ensure the workspace exists locally so CRDT sync has a target. createWorkspace auto-inits the
    // content doc; no actorKeypair → no membership root (the owner's root converges via sync).
    if (!(await this.workspaces.getEngine(wsId))) {
      await this.workspaces.createWorkspace({ workspaceId: wsId, displayName: wsId });
    }
    await this.registerSync(wsId, url, keypair);
    // Cold-start: directed-fetch the membership roster from a peer so the transit key installs NOW,
    // not on the next broadcast tick. Best-effort — a timeout/empty channel falls back to the tick.
    await this.directedMembershipFetch(wsId);
    // Fire-and-forget a content round so a joiner (transit key just installed) pulls content now.
    // syncNow swallows transient round failures internally; .catch defuses the stop/not-registered
    // race (the only throws left) — Debug because that race is expected during join, not a fault.
    void this.syncNow(wsId).catch((err) => {
      log.debug("join syncNow skipped (stopped or not registered)", { wsId, err });
    });
  }

  /** Run one round for `wsId` now instead of waiting for the next tick — `lode sync now`. Throws on
   *  usage errors (stopped / not registered); a registered-but-not-yet-wired workspace is a
   *  best-effort no-op — the wire poll covers it. Transient round failures are swallowed inside the
   *  driver's `roundNow`. */
  async syncNow(wsId: string): Promise<void> {
    if (this.stopped) {
      throw new PreconditionFailedError("sync registry stopped");
    }
    if (!this.registrations.has(wsId)) {
      throw new PreconditionFailedError(`syncNow: workspace ${wsId} is not registered for sync`);
    }
    await this.ensureWired(wsId);
    const handle = this.syncApps.get(wsId);
    if (handle) {
      await handle.driver.roundNow();
    }
  }

  /** The wired sync sub-graph's ChildApp for `wsId` (null if not wired). Test/observability seam —
   *  lets a test confirm the sub-graph stopped after removeWorkspace (its `isStopped` flips true when
   *  the workspace ChildApp's holder tears it down). */
  wiredSyncApp(wsId: string): Lifecycle | null {
    return this.syncApps.get(wsId)?.syncApp ?? null;
  }

  /** The lazy-wire + re-wire-on-reload backstop (the old `materialize`). Polls every registered
   *  workspace; registerSync wires immediately when loaded, so this only covers register-before-load
   *  and remove→reopen. */
  async run(signal: AbortSignal): Promise<void> {
    const wire = async (): Promise<void> => {
      try {
        await this.ensureAllWired();
      } catch (err) {
        log.warn("wire poll failed", { err });
      }
    };
    void wire(); // wire promptly on start, not after one poll interval
    return new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        void wire();
      }, WIRE_POLL_MS);
      signal.addEventListener(
        "abort",
        () => {
          clearInterval(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  stop(): void {
    this.stopped = true;
    // The sync sub-graphs live on the workspace ChildApps; WorkspaceRegistry.stop() — which
    // runs after this in the root Lifecycle's reverse-stop — calls workspaces.close(), stopping each
    // workspace ChildApp and (via the ChildLifecycleComponent holder) each sync sub-graph. So this clears
    // only the registry's bookkeeping; it does not own the sub-graphs' lifecycle.
    this.syncApps.clear();
    this.registrations.clear();
    this.lastNoOp.clear();
    this.url = undefined;
  }

  /** Drop all per-workspace bookkeeping for `wsId` — called from the workspace death point so a
   *  removed workspace leaves no ghost: `shareCoordinate`/`syncNow` then report not-registered, the
   *  wire poll skips the dead id, and the idle-log rate-limit entry is freed (no same-id-rebuild
   *  residue). The sync sub-graph itself already stopped with the workspace ChildApp; this clears
   *  only the registry's keyed state. */
  purge(wsId: string): void {
    this.registrations.delete(wsId);
    this.syncApps.delete(wsId);
    this.lastNoOp.delete(wsId);
  }

  /** One-shot directed membership fetch: ask ONE peer (by peerId) for the full membership doc and
   *  import it — wire security re-derives lazily, so `isMember()` reflects the imported roster on the
   *  next read. Best-effort: any failure (not wired, no other peer, timeout) is swallowed — the
   *  broadcast tick is the backstop. */
  private async directedMembershipFetch(wsId: string): Promise<void> {
    const handle = this.syncApps.get(wsId);
    if (handle === undefined) {
      return; // not wired yet — the tick will converge membership via broadcast
    }
    const { ctx } = handle;
    let target: string | undefined;
    try {
      const selfPeerId = this.workspaces.routingId();
      const peers = await ctx.transport.peers();
      target = peers.find((p) => p !== selfPeerId && p !== "");
      if (target === undefined) {
        return; // no other peer on the channel yet — wait for the broadcast round
      }
      const bytes = await ctx.transport.directedFetchUpdates(
        MEMBERSHIP_DOC_ID,
        await ctx.membershipDoc.version(), // the joiner's current membership version (empty → full doc)
        target,
      );
      if (bytes.length > 0) {
        await ctx.membershipDoc.importUpdate(bytes);
        await ctx.log.persistIfDirty();
        // No security refresh: wire security is a lazy projection of the log, so the next read
        // (the content round's isMember() gate) reflects the imported roster immediately.
      }
    } catch (err) {
      // Transient (peer mid-restart, relay blip, timeout) — the next broadcast tick retries.
      log.warn("directed membership fetch failed; falling back to broadcast tick", {
        wsId,
        peerId: target,
        err,
      });
    }
  }

  private async ensureAllWired(): Promise<void> {
    for (const wsId of this.registrations.keys()) {
      await this.ensureWired(wsId);
    }
  }

  /** Wire a registered workspace that's now open but not yet wired (peek-only `loadedEngine`, never
   *  the load path — no race with the doc-adding load). Also drops a stale sub-graph when the workspace
   *  was removed (engine gone) or reopened (a new ChildApp + engine). `createEngine` throws if called
   *  twice, so a stable workspace's engine never changes — the only "engine differs" path is
   *  remove→reopen, where the old sub-graph already stopped with the old workspace ChildApp. */
  private async ensureWired(wsId: string): Promise<void> {
    if (this.stopped || this.url === undefined) {
      return;
    }
    const engine = this.workspaces.loadedEngine(wsId);
    const existing = this.syncApps.get(wsId);
    if (existing) {
      if (engine === existing.engine) {
        return; // same engine — still valid
      }
      // Engine gone (removed) or a new one (reopened). The old sub-graph lived on the old workspace
      // ChildApp, which already stopped it — so this stop is idempotent. Drop the stale handle.
      this.syncApps.delete(wsId);
      try {
        await existing.syncApp.stop();
      } catch (err) {
        log.warn("stale sync app stop failed", { wsId, err });
      }
    }
    if (!engine) {
      return; // workspace not open (removed or never opened) — the poll retries
    }
    try {
      const handle = await this.buildSyncApp(wsId, engine);
      if (this.stopped) {
        // stop() ran while build was in flight — the workspace ChildApp will be torn down by
        // workspaces.close(), taking this sub-graph (its child) with it. Nothing to undo here.
        return;
      }
      this.syncApps.set(wsId, handle);
    } catch (err) {
      // skip this workspace this poll — retry on the next one.
      log.warn("sync wire build failed; retrying next poll", { wsId, err });
    }
  }

  /** Build the per-workspace sync sub-graph: a ChildApp nested under the workspace's own ChildApp
   *  (linked by a ChildLifecycleComponent holder so it tears down with the workspace), with the context
   *  (transport), the round driver (tick), and the push fast-path. Round bodies (membership +
   *  content) are plain collaborators held by the driver — no lifecycle of their own. The holder is
   *  registered AFTER start succeeds, so a failed build discards the child (no holder left on the
   *  workspace Lifecycle to conflict with a retry). */
  private async buildSyncApp(wsId: string, engine: Engine): Promise<SyncAppHandle> {
    const keypair = this.registrations.get(wsId);
    if (keypair === undefined) {
      throw new Error(`buildSyncApp: no actor registered for ${wsId}`);
    }
    const log_ = this.workspaces.membershipLog(wsId);
    if (log_ === null) {
      throw new Error(`buildSyncApp: no membership log for ${wsId} (workspace not loaded)`);
    }
    const wsApp = this.workspaces.loadedApp(wsId);
    if (wsApp === null) {
      throw new Error(`buildSyncApp: workspace ${wsId} not loaded`);
    }
    const local = this.workspaces.localPeerFor(keypair);
    const syncApp = wsApp.child();
    const ctx = new SyncContext({
      wsId,
      url: this.url ?? "",
      log: log_,
      local,
      engine,
    });
    const membership = new MembershipRound(ctx);
    const content = new ContentRound(ctx, this.report);
    const driver = new SyncRoundDriver({
      wsId,
      intervalMs: this.roundIntervalMs,
      membership,
      content,
    });
    const push = new PushFastPath(ctx);
    syncApp.register(ctx); // start opens the transport first…
    syncApp.register(driver); // …then the driver (run starts the tick)…
    syncApp.register(push); // …then push (start subscribes AFTER the transport is open)
    await syncApp.start();
    // Embed: register the holder AFTER start succeeds so a failed build leaves nothing on the
    // workspace Lifecycle. removeWorkspace → wsApp.stop() → holder.stop() → syncApp.stop() (engine+store+sync).
    wsApp.register(new ChildLifecycleComponent("sync-subgraph", syncApp));
    return { syncApp, engine, ctx, driver };
  }
}

/** The default round reporter when no host `onRound` is supplied: rate-limited idle logging + always
 *  log when ops were exchanged (the behavior of the old `DaemonSyncRunner.logRound`). The `lastNoOp`
 *  map is owned by the registry so a workspace's death can purge it. */
function defaultRoundReporter(
  lastNoOp: Map<string, number>,
): (wsId: string, summary: RoundSummary) => void {
  return (wsId, { pulled, pushed }) => {
    if (pulled + pushed > 0) {
      lastNoOp.delete(wsId);
      log.info("sync round exchanged", { wsId, docsPulled: pulled, docsPushed: pushed });
      return;
    }
    const now = Date.now();
    const last = lastNoOp.get(wsId) ?? 0;
    if (now - last >= NO_OP_LOG_INTERVAL_MS) {
      lastNoOp.set(wsId, now);
      log.info("sync round idle", { wsId });
    }
  };
}
