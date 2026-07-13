import { createLogger } from "@lode/logger";
import { MEMBERSHIP_DOC_ID } from "../membership/membership-log.js";
import { PreconditionFailedError } from "../../errors/index.js";
import type { WorkspaceRegistry } from "../workspace/registry.js";
import type { ActorKeypair } from "../../crypto/index.js";
import type { RuntimeResource } from "../kernel/resource.js";
import type { RoundSummary } from "./driver.js";
import type { SyncTransportFactory } from "./transport.js";
import { WorkspaceSyncSession } from "./workspace-sync-session.js";

const log = createLogger("sync.service");

/** Rate-limit for idle round-summary logs (~every 10th 20s tick). Rounds that exchange ops always log. */
const NO_OP_LOG_INTERVAL_MS = 200_000;
const DEFAULT_ROUND_INTERVAL_MS = 20_000;

/** What `shareCoordinate` hands a joiner: where to dial + which broker channel. The workspace's
 *  single content doc is auto-created at `createWorkspace`, so the joiner needs no doc id. */
export type WorkspaceCoordinateData = {
  readonly relayUrl: string;
  readonly workspaceId: string;
};

export type SyncServiceOptions = {
  readonly workspaces: WorkspaceRegistry;
  readonly transportFactory: SyncTransportFactory;
  readonly onRound?: (wsId: string, summary: RoundSummary) => void;
  readonly roundIntervalMs?: number;
};

/**
 * Cross-workspace coordinator for secured CRDT sync. It records the actor registration and relay
 * coordinate, while each `WorkspaceSyncSession` is owned by the corresponding workspace instance.
 * Workspace shutdown therefore quiesces and drains sync before disposing the engine and store; the
 * workspace event topic closes the service's keyed registration without a reverse dependency.
 *
 * The runner has NO identity of its own — every syncing workspace is registered by a session that
 * captures that session's actor keypair. The membership root is NOT bootstrapped here
 * (`createWorkspace` owns ACL-at-birth); this registry syncs whatever the engine's membership log
 * holds.
 */
export class SyncService implements RuntimeResource {
  readonly id = "sync.service";
  private readonly workspaces: WorkspaceRegistry;
  private readonly transportFactory: SyncTransportFactory;
  private readonly roundIntervalMs: number;
  private readonly report: (wsId: string, summary: RoundSummary) => void;
  private readonly registrations = new Map<string, ActorKeypair>();
  private readonly sessions = new Map<string, WorkspaceSyncSession>();
  /** Per-workspace idle-log rate-limit state — lives on the service (not in the reporter closure)
   *  so a workspace's death can purge it. Unused when a custom `onRound` is supplied. */
  private readonly lastNoOp = new Map<string, number>();
  private url?: string;
  private stopped = false;

  constructor(opts: SyncServiceOptions) {
    this.workspaces = opts.workspaces;
    this.transportFactory = opts.transportFactory;
    this.roundIntervalMs = opts.roundIntervalMs ?? DEFAULT_ROUND_INTERVAL_MS;
    this.report = opts.onRound ?? defaultRoundReporter(this.lastNoOp);
  }

  /** Register the session's actor to drive sync for `wsId` via `relayUrl`. Captures the keypair so
   *  rounds keep signing while the client is disconnected. One workspace → one registrant (its
   *  owner): a second, *different* actor re-registering is refused (it would overwrite the keypair
   *  that signs rounds + wires security); the same actor re-registering is idempotent. One relay per
   *  daemon (MVP). Membership governance (`addMember`) is NOT routed through here — it writes the
   *  membership log directly, relay-independent. */
  async registerSync(wsId: string, relayUrl: string, keypair: ActorKeypair): Promise<void> {
    if (this.stopped) {
      throw new PreconditionFailedError("sync service stopped");
    }
    await this.workspaces.runWorkspace(wsId, async () => {});
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
      throw new PreconditionFailedError("sync service stopped");
    }
    // Ensure the workspace exists locally so CRDT sync has a target. createWorkspace auto-inits the
    // content doc; no actorKeypair → no membership root (the owner's root converges via sync).
    if (!(await this.workspaces.hasWorkspace(wsId))) {
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
   *  best-effort no-op. Transient round failures are swallowed inside the
   *  driver's `roundNow`. */
  async syncNow(wsId: string): Promise<void> {
    if (this.stopped) {
      throw new PreconditionFailedError("sync service stopped");
    }
    if (!this.registrations.has(wsId)) {
      throw new PreconditionFailedError(`syncNow: workspace ${wsId} is not registered for sync`);
    }
    await this.ensureWired(wsId);
    const session = this.sessions.get(wsId);
    if (session) {
      await session.roundNow();
    }
  }

  release(): void {
    this.stopped = true;
    this.sessions.clear();
    this.registrations.clear();
    this.lastNoOp.clear();
    this.url = undefined;
  }

  /** Drop keyed coordination state after the workspace-owned topic closes. */
  private purge(wsId: string): void {
    this.registrations.delete(wsId);
    this.sessions.delete(wsId);
    this.lastNoOp.delete(wsId);
  }

  /** One-shot directed membership fetch: ask ONE peer (by peerId) for the full membership doc and
   *  import it — wire security re-derives lazily, so `isMember()` reflects the imported roster on the
   *  next read. Best-effort: any failure (not wired, no other peer, timeout) is swallowed — the
   *  broadcast tick is the backstop. */
  private async directedMembershipFetch(wsId: string): Promise<void> {
    const session = this.sessions.get(wsId);
    if (session === undefined) {
      return; // not wired yet — the tick will converge membership via broadcast
    }
    const ctx = session.context;
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
        await ctx.log.metaDoc.version(), // the joiner's current membership version (empty → full doc)
        target,
      );
      if (bytes.length > 0) {
        await ctx.log.metaDoc.importUpdate(bytes);
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

  private async ensureWired(wsId: string): Promise<void> {
    if (this.stopped || this.url === undefined) {
      return;
    }
    const keypair = this.registrations.get(wsId);
    if (keypair === undefined) {
      throw new PreconditionFailedError(`sync workspace is not registered: ${wsId}`);
    }
    const local = this.workspaces.localPeerFor(keypair);
    await this.workspaces.runWorkspace(wsId, async (workspace) => {
      const existing = this.sessions.get(wsId);
      if (existing?.workspace === workspace) {
        return;
      }
      await existing?.instance.stop();
      const session = await WorkspaceSyncSession.open({
        workspace,
        relayUrl: this.url ?? "",
        localPeer: local,
        transportFactory: this.transportFactory,
        roundIntervalMs: this.roundIntervalMs,
        report: this.report,
        onClosed: (closed) => this.purgeIfCurrent(wsId, closed),
      });
      if (this.stopped) {
        await session.instance.stop();
      } else {
        this.sessions.set(wsId, session);
      }
    });
  }

  private purgeIfCurrent(wsId: string, session: WorkspaceSyncSession): void {
    if (this.sessions.get(wsId) === session) {
      this.purge(wsId);
    }
  }
}

/** The default round reporter when no host `onRound` is supplied: rate-limited idle logging + always
 *  log when ops were exchanged (the behavior of the old `DaemonSyncRunner.logRound`). The `lastNoOp`
 *  map is owned by the service so a workspace's death can purge it. */
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
