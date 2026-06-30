/**
 * The broker routing core (design sync-design.md §3) — the pure, socket-free routing layer; the
 * WebSocket server/client (`broker-server.ts`/`broker-client.ts`) are adapters around it.
 *
 * The broker is **routing-aware + content-blind + no-auth + no content storage**:
 *   - routing-aware — a subscription table `Map<wsId, Set<peerId>>`; routes per-workspace;
 *   - content-blind — the payload is opaque bytes, never decoded;
 *   - no-auth — it does not check MEMBERSHIP (clients enforce that). The one pinned rule is a
 *     *routing* invariant matching §3 "subscriber publishes": the publisher must be SUBSCRIBED to the
 *     workspace (a non-subscriber publish throws);
 *   - no content storage — it forwards, never persists workspace content.
 */

/** A connected peer, as the broker sees it: an id + a sink for delivered payloads. */
export type BrokerPeer = {
  readonly id: string;
  /** Broker → peer: deliver a routed payload for `wsId`. */
  deliver(wsId: string, payload: Uint8Array): void;
};

export type Broker = {
  connect(peer: BrokerPeer): void;
  subscribe(peerId: string, wsId: string): void;
  unsubscribe(peerId: string, wsId: string): void;
  /** Route `payload` to subscribers(wsId) minus the sender. Throws if sender ∉ subscribers(wsId). */
  publish(senderId: string, wsId: string, payload: Uint8Array): void;
  disconnect(peerId: string): void;
};

export function createBroker(): Broker {
  const peers = new Map<string, BrokerPeer>();
  const subs = new Map<string, Set<string>>(); // wsId → subscriber peer ids

  return {
    connect(peer: BrokerPeer): void {
      peers.set(peer.id, peer);
    },
    subscribe(peerId: string, wsId: string): void {
      let set = subs.get(wsId);
      if (!set) {
        set = new Set();
        subs.set(wsId, set);
      }
      set.add(peerId);
    },
    unsubscribe(peerId: string, wsId: string): void {
      subs.get(wsId)?.delete(peerId);
    },
    publish(senderId: string, wsId: string, payload: Uint8Array): void {
      const recipients = subs.get(wsId);
      // Pinned routing invariant (§3 "subscriber publishes"): publisher must be subscribed. This is a
      // routing rule, NOT an auth check (membership/allowlist is client-side).
      if (!recipients || !recipients.has(senderId)) {
        throw new Error(`publish: ${senderId} is not subscribed to workspace ${wsId}`);
      }
      for (const peerId of recipients) {
        if (peerId === senderId) {
          continue; // sender-exclusion (no echo)
        }
        peers.get(peerId)?.deliver(wsId, payload);
      }
    },
    disconnect(peerId: string): void {
      peers.delete(peerId);
      for (const set of subs.values()) {
        set.delete(peerId);
      }
    },
  };
}
