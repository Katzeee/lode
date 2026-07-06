import { BrokerSyncProtocol } from "../broker/broker-sync-transport.js";
import { SyncManager } from "./sync-manager.js";
import { MembershipSync } from "../membership/membership-sync.js";
import {
  createMembershipWireSecurity,
  type MembershipWireSecurity,
} from "../membership/membership-security.js";
import type { MembershipLog, LocalPeer } from "../membership/membership-log.js";
import type { Engine } from "../../core/engine.js";
import type { ShardedBlockStore, SyncDoc } from "../../core/sharded-store.js";
import type { Component } from "../app.js";

/**
 * The per-workspace shared state for the sync sub-graph — the lode analog of any-sync's
 * `spacestate.SpaceState`. Constructed by the `SyncRegistry`, passed by reference to the
 * round bodies + push path (constructor injection, not service-locator lookup).
 *
 * Construction is synchronous (it was the non-async body of the old `DaemonSyncRunner.build()`):
 * create wire security, refresh it so the transport is built against the live transit key, derive
 * the membership sync doc, and build the broker transport + `SyncManager` + `MembershipSync`. Only
 * `transport.open()` is async, so that alone lives in `start()`; `stop()` closes it. The round
 * driver runs in the App's run phase — after `start()` — so it always sees an open transport.
 */
export type SyncContextInput = {
  readonly wsId: string;
  readonly url: string;
  readonly store: ShardedBlockStore;
  readonly log: MembershipLog;
  readonly local: LocalPeer;
  readonly engine: Engine;
};

export class SyncContext implements Component {
  readonly name = "sync.ctx";
  readonly transport: BrokerSyncProtocol;
  readonly syncManager: SyncManager;
  readonly membershipSync: MembershipSync;
  readonly security: MembershipWireSecurity;
  readonly membershipDoc: SyncDoc;

  constructor(private readonly input: SyncContextInput) {
    const { store, log, local, url, wsId } = this.input;
    // The actor is per-workspace (the registered session); the peer key + peerId are per-dataRoot.
    // Together they are this replica's LocalPeer for wire security.
    const security = createMembershipWireSecurity({ log, local });
    security.refresh();
    const membershipDoc = log.toSyncDoc();
    this.security = security;
    this.membershipDoc = membershipDoc;
    this.transport = new BrokerSyncProtocol({
      url,
      store,
      workspaceId: wsId,
      security: security.security,
      // The membership doc rides the plaintext envelope (a public roster) AND is served on push-apply.
      publicDocs: () => [membershipDoc],
      // Declare this replica's site id so it's a directed target + discoverable via peers().
      peerId: local.peerId,
    });
    this.syncManager = new SyncManager(store, this.transport);
    this.membershipSync = new MembershipSync(this.transport, membershipDoc);
  }

  get wsId(): string {
    return this.input.wsId;
  }
  get engine(): Engine {
    return this.input.engine;
  }
  get log(): MembershipLog {
    return this.input.log;
  }

  async start(): Promise<void> {
    await this.transport.open();
  }

  stop(): void {
    // close() is synchronous (void) on BrokerSyncProtocol.
    this.transport.close();
  }
}
