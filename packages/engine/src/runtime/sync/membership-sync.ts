import type { SyncableDoc } from "../../core/store/syncable.js";
import type { SyncTransport } from "./transport.js";
import type { WorkspaceLock } from "../workspace/loro-lock.js";

/**
 * Drives one membership-doc gossip round over a transport (design sync-identity-persistence §2/§9).
 * The membership log is a PUBLIC signed roster, so its doc rides the broker's PLAINTEXT envelope:
 * each peer pushes its current snapshot every round and imports what it receives (Loro CRDT merge →
 * every replica converges). One-way PUSH (not req/resp) on purpose — a joining peer must converge
 * the roster BEFORE it holds the transit key (the bootstrap chicken-and-egg), and pushing every round
 * IS the heartbeat that reaches a peer that subscribed late.
 *
 * `doc` is the membership log's `SyncableDoc` (id `MEMBERSHIP_DOC_ID`) — the same adapter the transport
 * serves on its push-apply path, so send and receive share one API. Sibling of `SyncExchange`
 * (content docs, sealed): a host runs both over one transport each round — membership first, so the
 * security context the content round uses is fresh.
 *
 * Push our membership snapshot so peers can import + converge. Idempotent (CRDT merge). The snapshot
 * export is a loro read → SHARED lock; the network send runs outside the lock. Production passes the
 * workspace's `RwWorkspaceLock`; core protocol tests over bare docs pass `NoopWorkspaceLock`.
 */
export async function syncMembershipDoc(
  transport: SyncTransport,
  doc: SyncableDoc,
  lock: WorkspaceLock,
): Promise<void> {
  const snapshot = await lock.read(() => doc.exportSnapshot());
  await transport.sendUpdates(doc.id, snapshot);
}
