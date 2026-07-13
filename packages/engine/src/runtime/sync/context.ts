import { SyncExchange } from "./sync-exchange.js";
import {
  createMembershipWireSecurity,
  type MembershipWireSecurity,
} from "../membership/membership-security.js";
import type { MembershipLog, LocalPeer } from "../membership/membership-log.js";
import type { Engine } from "../../core/engine.js";
import { WorkspaceDocSet } from "../../core/store/doc-set.js";
import type { RuntimeResource } from "../kernel/resource.js";
import type { Bus } from "../../events/bus.js";
import type { ManagedSyncTransport, SyncTransport, SyncTransportFactory } from "./transport.js";

/**
 * The per-workspace shared state for the sync sub-graph — the lode analog of any-sync's
 * `spacestate.SpaceState`. Constructed by the `WorkspaceSyncSession`, passed by reference to the
 * round driver + push path (constructor injection, not service-locator lookup).
 *
 * Construction is synchronous (it was the non-async body of the old `DaemonSyncRunner.build()`):
 * create wire security (its transit key is derived eagerly from the log, so the transport is built
 * against the live key), derive the membership sync doc, and build the broker transport +
 * `SyncExchange`. Only `transport.open()` is async, so that alone lives in `start()`; instance
 * release closes it. The round driver starts only after the transport is ready — so it always sees
 * an open transport.
 */
export type SyncContextInput = {
  readonly wsId: string;
  readonly url: string;
  readonly log: MembershipLog;
  readonly local: LocalPeer;
  readonly engine: Engine;
  readonly facts: Bus;
  readonly transportFactory: SyncTransportFactory;
};

export class SyncContext implements RuntimeResource {
  readonly id = "sync.ctx";
  /** The concrete broker — held privately for its lifecycle (`open`/`close`), which is NOT part of
   *  the `SyncTransport` wire contract. Wire consumers read `transport` (the port) below; only this
   *  context, as the sync sub-graph's composition root, knows the concrete impl. */
  private readonly managedTransport: ManagedSyncTransport;
  readonly syncManager: SyncExchange;
  readonly security: MembershipWireSecurity;
  readonly wsId: string;
  readonly engine: Engine;
  readonly log: MembershipLog;
  readonly facts: Bus;

  constructor(input: SyncContextInput) {
    const { log, local, url, wsId, engine, transportFactory, facts } = input;
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
    this.managedTransport = transportFactory({
      url,
      documents: docSet,
      workspaceId: wsId,
      security: security.security,
      // Declare this replica's site id so it's a directed target + discoverable via peers().
      peerId: local.peerId,
    });
    this.syncManager = new SyncExchange(docSet.composite(), this.managedTransport);
    this.wsId = wsId;
    this.engine = engine;
    this.log = log;
    this.facts = facts;
  }

  /** The wire transport. Consumers (round driver, membership push, directed bootstrap) depend on
   *  the `SyncTransport` port, not the concrete broker — so the transport is swappable + mockable. */
  get transport(): SyncTransport {
    return this.managedTransport;
  }

  async start(): Promise<void> {
    await this.managedTransport.open();
  }

  async release(): Promise<void> {
    await this.managedTransport.close();
  }
}
