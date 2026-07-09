import { BrokerSyncProtocol } from "../broker/broker-sync-transport.js";
import { SyncManager, type SyncTransport } from "./sync-manager.js";
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
 * create wire security (its transit key is derived eagerly from the log, so the transport is built
 * against the live key), derive the membership sync doc, and build the broker transport +
 * `SyncManager` + `MembershipSync`. Only `transport.open()` is async, so that alone lives in
 * `start()`; `stop()` closes it. The round driver runs in the App's run phase — after `start()` —
 * so it always sees an open transport.
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
  /** The concrete broker — held privately for its lifecycle (`open`/`close`), which is NOT part of
   *  the `SyncTransport` wire contract. Wire consumers read `transport` (the port) below; only this
   *  context, as the sync sub-graph's composition root, knows the concrete impl. */
  private readonly broker: BrokerSyncProtocol;
  readonly syncManager: SyncManager;
  readonly membershipSync: MembershipSync;
  readonly security: MembershipWireSecurity;
  readonly membershipDoc: SyncableDoc;

  constructor(private readonly input: SyncContextInput) {
    const { log, local, url, wsId, engine } = this.input;
    // The actor is per-workspace (the registered session); the peer key + peerId are per-dataRoot.
    // Together they are this replica's LocalPeer for wire security. Wire security is a lazy
    // projection of the log (transit key re-derived on read when the frontier moves), so the
    // transport is built against the live key with no refresh step here.
    const security = createMembershipWireSecurity({ log, local });
    const membershipDoc = log.metaDoc;
    // The unified doc set: the outliner (sealed content) + the membership log (public roster). The
    // broker reads doc visibility + the doc lookup from this single source — each doc's declared
    // `securityClass` drives its wire envelope via `BrokerSyncProtocol.envelopeFor`.
    const docSet = new WorkspaceDocSet(engine.asOutliner());
    docSet.registerMeta(membershipDoc, "public");
    this.security = security;
    this.membershipDoc = membershipDoc;
    this.broker = new BrokerSyncProtocol({
      url,
      docSet,
      workspaceId: wsId,
      security: security.security,
      // Declare this replica's site id so it's a directed target + discoverable via peers().
      peerId: local.peerId,
    });
    this.syncManager = new SyncManager(docSet.composite(), this.broker);
    this.membershipSync = new MembershipSync(this.broker, membershipDoc);
  }

  /** The wire transport. Consumers (round driver, membership push, directed bootstrap) depend on
   *  the `SyncTransport` port, not the concrete broker — so the transport is swappable + mockable. */
  get transport(): SyncTransport {
    return this.broker;
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
    await this.broker.open();
  }

  stop(): void {
    // close() is synchronous (void) on BrokerSyncProtocol.
    this.broker.close();
  }
}
