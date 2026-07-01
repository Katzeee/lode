import { randomBytes } from "node:crypto";
import { LoroDoc } from "loro-crdt";
import {
  MembershipLog,
  MembershipSync,
  SyncManager,
  actorEncryptionPublic,
  actorIdFromPublicKey,
  createMembershipWireSecurity,
  type AppRuntime,
  type ActorKeypair,
  type Component,
  type MembershipWireSecurity,
  type ShardedBlockStore,
} from "@lode/engine";
import { BrokerClientSyncTransport } from "@lode/transport";

export type DaemonSyncRunnerOptions = {
  readonly workspaces: AppRuntime["workspaces"];
  /** Relay WebSocket URL, e.g. `ws://127.0.0.1:4193`. Optional — a member daemon starts without one
   *  and receives it when it joins a workspace. */
  readonly url?: string;
  /** Workspace ids to sync at startup. The owner pre-configures the workspace it owns (and bootstraps
   *  it); a member joins workspaces at runtime via `joinWorkspace`. */
  readonly workspaceIds: readonly string[];
  /** The daemon's actor keypair (from `--actor-mnemonic`). Sync is always secured (transit-key AEAD +
   *  the membership log); mobile composes the same pieces in-process when it dials a relay directly. */
  readonly actorKeypair: ActorKeypair;
  /** Round interval; default 1000ms. */
  readonly intervalMs?: number;
};

/** What `shareWorkspace` hands a joiner: where to dial + which broker channel + which doc to create. */
export type WorkspaceCoordinateData = {
  readonly relayUrl: string;
  readonly workspaceId: string;
  readonly docId: string;
};

type Wired = {
  readonly transport: BrokerClientSyncTransport;
  readonly sync: SyncManager; // content docs (sealed)
  readonly membershipSync: MembershipSync; // the membership doc (plaintext)
  readonly sec: MembershipWireSecurity;
  readonly log: MembershipLog;
};

/**
 * Drives secured CRDT sync rounds for one or more workspaces over a relay. For each workspace it
 * lazily builds a secured `BrokerClientSyncTransport` + `SyncManager` once the workspace is open,
 * subscribes to the workspace's broker channel, and runs periodic rounds. An App `Component`.
 *
 * Each round: the membership log rides the broker's plaintext envelope (`MembershipSync` gossip),
 * `sec.refresh()` installs the live transit key + member set, then the content `SyncManager.sync()`
 * runs sealed — only once the local actor is a member (before the log converges it isn't, so content
 * is skipped, not errored; the membership round is what lets it join).
 *
 * Two entry shapes: the **owner** pre-configures its workspace (`url` + `workspaceIds` at construction)
 * and self-appends the membership root on an empty log; members then arrive via `addMember`. A
 * **member** starts with no relay and calls `joinWorkspace` with a coordinate — it creates the
 * workspace + doc locally and converges the owner's root + content over the relay (never bootstrapping).
 *
 * Host glue: composes the engine's per-workspace `ShardedBlockStore` (via the peek-only
 * `loadedEngine().getShardedStore()`) with `@lode/transport`'s broker transport and the engine's
 * `SyncManager`/`MembershipSync`. It lives in the daemon (the desktop host); mobile composes the same
 * pieces in-process.
 */
export class DaemonSyncRunner implements Component {
  readonly name = "sync-runner";
  private readonly intervalMs: number;
  private readonly wired = new Map<string, Wired>();
  /** The relay URL. Undefined until the runner is synced (owner: at construction; member: on join). */
  private url: string | undefined;
  /** All workspace ids this runner syncs (owner-configured ∪ joined). */
  private readonly workspaceIds: Set<string>;
  /** Workspaces this replica OWNS (configured at startup) → may self-append the membership root when
   *  the log is empty. Joined workspaces never bootstrap — they converge the owner's root. */
  private readonly ownerWorkspaces: Set<string>;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopped = false;

  constructor(private readonly opts: DaemonSyncRunnerOptions) {
    this.intervalMs = opts.intervalMs ?? 1000;
    this.url = opts.url;
    this.workspaceIds = new Set(opts.workspaceIds);
    this.ownerWorkspaces = new Set(opts.workspaceIds);
  }

  /** Wire any already-open workspaces, then drive a round every `intervalMs`. */
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
        await w.membershipSync.sync();
        await w.log.persistIfDirty();
        w.sec.refresh();
        if (w.sec.isMember()) {
          await w.sync.sync();
        }
      }
    } catch {
      // A round may fail transiently (relay blip, a peer mid-restart, a content round whose peer
      // hasn't converged membership yet). Never abort the driver — the next round retries.
    } finally {
      this.busy = false;
    }
  }

  /** Serialize materialize so concurrent callers (the tick loop + `joinWorkspace` + `addMember`)
   *  never double-build a workspace — two transports for one workspace leaks one + breaks
   *  convergence. Each call runs the body after any in-flight one resolves. */
  private materializeChain: Promise<void> = Promise.resolve();
  private materialize(): Promise<void> {
    const run = () => this.doMaterialize();
    this.materializeChain = this.materializeChain.then(run, run);
    return this.materializeChain;
  }

  /** Build a secured transport for any requested workspace that's now open but not yet wired. Uses
   *  the peek-only `loadedEngine` (NOT the load path) so attaching here never races with the
   *  doc-adding load — a workspace is wired only once it's already open with its doc. No-op until a
   *  relay URL is set (a member before its first join). */
  private async doMaterialize(): Promise<void> {
    const url = this.url;
    if (url === undefined) {
      return;
    }
    for (const wsId of this.workspaceIds) {
      if (this.wired.has(wsId)) {
        continue;
      }
      const store = this.opts.workspaces.loadedEngine(wsId)?.getShardedStore() ?? null;
      if (!store) {
        continue; // workspace not open yet — retry next tick
      }
      const wired = await this.build(wsId, store, url);
      if (this.stopped) {
        wired.transport.close(); // stop() ran while open() was in flight — don't leak the transport.
        return;
      }
      this.wired.set(wsId, wired);
    }
  }

  private async build(wsId: string, store: ShardedBlockStore, url: string): Promise<Wired> {
    const keypair = this.opts.actorKeypair;
    // Engine-owned persistence: load the membership snapshot (if any) before deciding to bootstrap,
    // so a restart reuses the persisted log instead of re-appending the root.
    const persistence = this.opts.workspaces.membershipPersistence(wsId) ?? undefined;
    const log = new MembershipLog(new LoroDoc(), persistence);
    await log.load();
    // The owner self-appends the root on an empty log; members then arrive via addMember. A joined
    // (non-owner) workspace never bootstraps — it converges the owner's root over the relay.
    if (log.records().length === 0 && this.ownerWorkspaces.has(wsId)) {
      log.appendRoot(keypair, randomBytes(32));
    }
    await log.persistIfDirty(); // durably store a freshly bootstrapped root (no-op if only loaded)
    const sec = createMembershipWireSecurity({ log, keypair });
    sec.refresh();
    const membershipDoc = log.toSyncDoc();
    const transport = new BrokerClientSyncTransport({
      url,
      store,
      workspaceId: wsId,
      security: sec.security,
      // The membership doc rides the plaintext envelope (a public roster) AND is served on push-apply.
      publicDocs: () => [membershipDoc],
    });
    await transport.open();
    return {
      transport,
      sync: new SyncManager(store, transport),
      membershipSync: new MembershipSync(transport, membershipDoc),
      sec,
      log,
    };
  }

  /** Owner governance: add a member to a workspace — the current-epoch transit key wrapped to their
   *  X25519 pub. The new record is persisted + gossiped on the next round. Throws if the workspace
   *  isn't wired or the caller isn't the owner. */
  async addMember(wsId: string, memberSignPub: Uint8Array): Promise<void> {
    await this.materialize();
    const w = this.wired.get(wsId);
    if (!w) {
      throw new Error(`sync not wired for workspace: ${wsId}`);
    }
    const owner = this.opts.actorKeypair;
    const { state } = w.log.deriveState();
    if (state.owner !== owner.actorId) {
      throw new Error("addMember: only the owner can add members");
    }
    const transitKey = w.log.unwrapCurrentTransitKey(state, owner);
    w.log.appendAdd(
      owner,
      {
        actorId: actorIdFromPublicKey(memberSignPub),
        signPub: memberSignPub,
        encPub: actorEncryptionPublic(memberSignPub),
      },
      transitKey,
      state.currentEpoch,
    );
    await w.log.persistIfDirty();
  }

  /** The coordinate an owner hands a joiner: the relay URL + workspace id + the workspace's single
   *  content doc id (so the joiner creates a matching doc for CRDT sync to apply). */
  async shareCoordinate(wsId: string): Promise<WorkspaceCoordinateData> {
    if (this.url === undefined) {
      throw new Error("share: not synced to a relay");
    }
    const docIds = await this.opts.workspaces.listDocs(wsId);
    const docId = docIds[0];
    if (!docId) {
      throw new Error(`share: workspace ${wsId} has no content doc`);
    }
    return { relayUrl: this.url, workspaceId: wsId, docId };
  }

  /** Member side: dial `url` and sync `wsId`, creating the workspace + doc locally first (empty — the
   *  owner's content converges into it). One relay per daemon: a join to a different relay errors.
   *  Idempotent for the same workspace. */
  async joinWorkspace(wsId: string, url: string, docId: string): Promise<void> {
    if (this.stopped) {
      throw new Error("sync runner stopped");
    }
    if (this.url === undefined) {
      this.url = url;
    } else if (this.url !== url) {
      throw new Error(`already syncing a different relay: ${this.url} (requested ${url})`);
    }
    // Ensure the workspace + doc exist locally so CRDT sync has a target. Re-join after restart: the
    // workspace already exists — just ensure the doc.
    const engine = await this.opts.workspaces.getEngine(wsId);
    if (!engine) {
      await this.opts.workspaces.createWorkspace({ workspaceId: wsId, displayName: wsId });
      await this.opts.workspaces.createDoc({ workspaceId: wsId, docId, displayName: docId });
    } else {
      const docs = await this.opts.workspaces.listDocs(wsId);
      if (!docs.includes(docId)) {
        await this.opts.workspaces.createDoc({ workspaceId: wsId, docId, displayName: docId });
      }
    }
    this.workspaceIds.add(wsId);
    await this.materialize(); // url is set + workspace is open → wire it now
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
  }
}
