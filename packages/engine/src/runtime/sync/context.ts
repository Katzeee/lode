import { BrokerSyncProtocol } from "../broker/broker-sync-transport.js";
import { SyncManager } from "./sync-manager.js";
import { MembershipSync } from "../membership/membership-sync.js";
import {
  createMembershipWireSecurity,
  type MembershipWireSecurity,
} from "../membership/membership-security.js";
import type { MembershipLog, LocalPeer } from "../membership/membership-log.js";
import type { Engine } from "../../core/engine.js";
import type { SyncableDoc } from "../../core/store/syncable.js";
import { WorkspaceDocSet } from "../../core/store/doc-set.js";
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
  readonly membershipDoc: SyncableDoc;

  constructor(private readonly input: SyncContextInput) {
    const { log, local, url, wsId, engine } = this.input;
    // The actor is per-workspace (the registered session); the peer key + peerId are per-dataRoot.
    // Together they are this replica's LocalPeer for wire security.
    const security = createMembershipWireSecurity({ log, local });
    security.refresh();
    const membershipDoc = log.metaDoc;
    // The unified doc set: the outliner (sealed content) + the membership log (public roster). The
    // broker reads visibility + the doc lookup from this single source — the publicDocs side-thunk
    // and its isPublicDoc array scan are gone.
    const docSet = new WorkspaceDocSet(engine.asOutliner());
    docSet.registerMeta(membershipDoc, "public");
    this.security = security;
    this.membershipDoc = membershipDoc;
    this.transport = new BrokerSyncProtocol({
      url,
      docSet,
      workspaceId: wsId,
      security: security.security,
      // Declare this replica's site id so it's a directed target + discoverable via peers().
      peerId: local.peerId,
    });
    this.syncManager = new SyncManager(docSet.composite(), this.transport);
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
