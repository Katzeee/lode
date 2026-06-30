import { randomBytes } from "node:crypto";
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
  /** Relay WebSocket URL, e.g. `ws://127.0.0.1:4193`. */
  readonly url: string;
  /** Workspace ids to sync (each subscribes to its own broker channel = its workspace id). */
  readonly workspaceIds: string[];
  /** The daemon's actor keypair (from `--actor-mnemonic`). Sync is always secured (transit-key AEAD +
   *  the membership log); mobile composes the same pieces in-process when it dials a relay directly. */
  readonly actorKeypair: ActorKeypair;
  /** Round interval; default 1000ms. */
  readonly intervalMs?: number;
  /** Owner bootstrap: each member's sign pub to `add` once, the first time an empty membership log is
   *  materialized. A declarative stand-in — the owner should bootstrap via a coordinate-import RPC
   *  after the workspace loads, not at boot. */
  readonly bootstrapMembers?: Uint8Array[];
};

type Wired = {
  readonly transport: BrokerClientSyncTransport;
  readonly sync: SyncManager; // content docs (sealed)
  readonly membershipSync: MembershipSync; // the membership doc (plaintext)
  readonly sec: MembershipWireSecurity;
  readonly log: MembershipLog;
};

/**
 * Drives secured CRDT sync rounds for one or more workspaces over a relay. For each requested
 * workspace it lazily builds a secured `BrokerClientSyncTransport` + `SyncManager` once the workspace
 * is open, subscribes to the workspace's broker channel, and runs periodic rounds. An App `Component`.
 *
 * Each round: the membership log rides the broker's plaintext envelope (`MembershipSync` gossip),
 * `sec.refresh()` installs the live transit key + member set, then the content `SyncManager.sync()`
 * runs sealed — only once the local actor is a member (before the log converges it isn't, so content
 * is skipped, not errored; the membership round is what lets it join). The owner bootstraps the root +
 * initial members on first materialize of an empty log.
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
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopped = false;

  constructor(private readonly opts: DaemonSyncRunnerOptions) {
    this.intervalMs = opts.intervalMs ?? 1000;
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

  /** Build a secured transport for any requested workspace that's now open but not yet wired. Uses
   *  the peek-only `loadedEngine` (NOT the load path) so attaching here never races with the
   *  doc-adding load — a workspace is wired only once it's already open with its doc. */
  private async materialize(): Promise<void> {
    for (const wsId of this.opts.workspaceIds) {
      if (this.wired.has(wsId)) {
        continue;
      }
      const store = this.opts.workspaces.loadedEngine(wsId)?.getShardedStore() ?? null;
      if (!store) {
        continue; // workspace not open yet — retry next tick
      }
      const wired = await this.build(wsId, store);
      if (this.stopped) {
        wired.transport.close(); // stop() ran while open() was in flight — don't leak the transport.
        return;
      }
      this.wired.set(wsId, wired);
    }
  }

  private async build(wsId: string, store: ShardedBlockStore): Promise<Wired> {
    const keypair = this.opts.actorKeypair;
    const log = new MembershipLog();
    // Owner bootstrap (once, on an empty log): root + an `add` per configured member.
    if (log.records().length === 0 && (this.opts.bootstrapMembers?.length ?? 0) > 0) {
      this.bootstrap(log, keypair);
    }
    const sec = createMembershipWireSecurity({ log, keypair });
    sec.refresh();
    const membershipDoc = log.toSyncDoc();
    const transport = new BrokerClientSyncTransport({
      url: this.opts.url,
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

  /** Generate a transit key, append the root (owner self-wrapped), and `add` each configured member
   *  (the current transit key wrapped to their X25519 pub). */
  private bootstrap(log: MembershipLog, owner: ActorKeypair): void {
    const transitKey = randomBytes(32);
    log.appendRoot(owner, transitKey);
    for (const signPub of this.opts.bootstrapMembers ?? []) {
      log.appendAdd(
        owner,
        { actorId: actorIdFromPublicKey(signPub), signPub, encPub: actorEncryptionPublic(signPub) },
        transitKey,
        0,
      );
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
  }
}
