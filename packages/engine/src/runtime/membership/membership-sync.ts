import type { SyncDoc } from "../../core/sharded-store.js";
import type { SyncTransport } from "../sync.js";

/**
 * Drives one membership-doc gossip round over a transport (design sync-identity-persistence §2/§9).
 * The membership log is a PUBLIC signed roster, so its doc rides the broker's PLAINTEXT envelope:
 * each peer pushes its current snapshot every round and imports what it receives (Loro CRDT merge →
 * every replica converges). One-way PUSH (not req/resp) on purpose — a joining peer must converge
 * the roster BEFORE it holds the transit key (the bootstrap chicken-and-egg), and pushing every round
 * IS the heartbeat that reaches a peer that subscribed late.
 *
 * `doc` is the membership log's `SyncDoc` (id `MEMBERSHIP_DOC_ID`) — the same adapter the transport
 * serves on its push-apply path, so send and receive share one API. Sibling of `SyncManager`
 * (content docs, sealed): a host runs both over one transport each round — membership first, so the
 * security context the content round uses is fresh.
 */
export class MembershipSync {
  constructor(
    private readonly transport: SyncTransport,
    private readonly doc: SyncDoc,
  ) {}

  /** Push our membership snapshot so peers can import + converge. Idempotent (CRDT merge). */
  async sync(): Promise<void> {
    await this.transport.sendUpdates(this.doc.id, this.doc.exportSnapshot());
  }
}
