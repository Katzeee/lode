/**
 * The broker routing core (design sync-design.md §3) — the pure, socket-free routing layer; the
 * WebSocket server/client (`broker-server.ts`/`broker-client.ts`) are adapters around it.
 *
 * The broker is **routing-aware + content-blind + no-auth + no content storage**:
 *   - routing-aware — two tables per channel: `conns` (subscriber connection ids) and `byPeer`
 *     (dataRoot peerId → connection), the directed-routing table (§3c). `peers(wsId)` exposes the
 *     latter so a client can ask "who is on this channel?" before a directed request;
 *   - content-blind — the payload is opaque bytes, never decoded;
 *   - no-auth — it does not check MEMBERSHIP (clients enforce that). The one pinned rule is a
 *     *routing* invariant matching §3 "subscriber publishes": the publisher must be SUBSCRIBED to the
 *     workspace (a non-subscriber publish throws);
 *   - no content storage — it forwards, never persists workspace content.
 *
 * peerId (the directed-routing identity) is per-dataRoot, declared at subscribe. It is a routing
 * *hint*, not a trust anchor: the relay is no-auth so peerId is spoofable (last-writer-wins on the
 * route table); trust comes from the AEAD seal + actor signature on the content, never from peerId.
 */

/** A connected peer, as the broker sees it: a connection id + a sink for delivered payloads. */
export type BrokerPeer = {
  /** Connection id (server-assigned, e.g. `c0`); NOT the dataRoot peerId. */
  readonly id: string;
  /** Broker → peer: deliver a routed payload for `wsId`, with the publisher's routing `fromPeerId`
   *  ("" if the publisher declared none). Lets a responder direct its reply at the asker (§3c). */
  deliver(wsId: string, payload: Uint8Array, fromPeerId: string): void;
};

export type Broker = {
  connect(peer: BrokerPeer): void;
  /** Subscribe `connId` to `wsId`. `peerId` (the dataRoot routing id) opts the peer into directed
   *  delivery + the `peers(wsId)` listing; omit it for broadcast-only. */
  subscribe(connId: string, wsId: string, peerId?: string): void;
  unsubscribe(connId: string, wsId: string): void;
  /** Route `payload` to subscribers(wsId) minus the sender (broadcast), or to one `toPeerId` only
   *  (directed — silent no-op if unknown/disconnected/self; liveness is the client's job). Throws if
   *  the sender is not subscribed (routing invariant, not auth). */
  publish(connId: string, wsId: string, payload: Uint8Array, toPeerId?: string): void;
  /** The dataRoot peerIds currently declared on `wsId` (peers that can be a directed target). */
  peers(wsId: string): string[];
  /** Whether `connId` is currently subscribed to `wsId` (the channel-activeness check). */
  isSubscribed(connId: string, wsId: string): boolean;
  disconnect(connId: string): void;
};

/** Per-channel routing state. `conns` drives broadcast; `byPeer`/`peerOf` drive directed + cleanup. */
type Channel = {
  readonly conns: Set<string>; // subscriber connection ids
  readonly byPeer: Map<string, string>; // routing peerId → connId (the directed route table)
  readonly peerOf: Map<string, string>; // connId → routing peerId (so cleanup knows what to remove)
};

export function createBroker(): Broker {
  const peers = new Map<string, BrokerPeer>(); // connId → peer
  const channels = new Map<string, Channel>();

  const channel = (wsId: string): Channel => {
    let ch = channels.get(wsId);
    if (!ch) {
      ch = { conns: new Set(), byPeer: new Map(), peerOf: new Map() };
      channels.set(wsId, ch);
    }
    return ch;
  };

  /** Remove `connId` from `wsId`'s tables, clearing its route entry only if it still owns it; drop
   *  the channel entirely once it has no subscribers. */
  const leave = (connId: string, wsId: string): void => {
    const ch = channels.get(wsId);
    if (!ch) {
      return;
    }
    const peerId = ch.peerOf.get(connId);
    ch.conns.delete(connId);
    ch.peerOf.delete(connId);
    // Another conn may have since claimed the same peerId (last-writer-wins) — only clear the entry
    // if it still points at the leaving conn.
    if (peerId !== undefined && ch.byPeer.get(peerId) === connId) {
      ch.byPeer.delete(peerId);
    }
    // Drop the channel once it's empty — a long-lived relay otherwise accumulates a dead Channel per
    // workspace it ever routed. (Safe during `disconnect`'s Map iteration: leave deletes only the wsId
    // it was passed, never an unvisited one.)
    if (ch.conns.size === 0) {
      channels.delete(wsId);
    }
  };

  return {
    connect(peer: BrokerPeer): void {
      peers.set(peer.id, peer);
    },
    subscribe(connId: string, wsId: string, peerId?: string): void {
      const ch = channel(wsId);
      // Re-subscribing the same conn with a different (or absent) peerId must clear its prior route
      // entry — otherwise the old peerId would still point here (a directed misroute) and outlive
      // disconnect (the leave path only knows the *current* peerId, so the stale entry would never be
      // collected, and `peers()` would keep reporting a phantom). last-writer-wins still holds for a
      // collision between *different* conns claiming the same peerId.
      const prev = ch.peerOf.get(connId);
      if (prev !== undefined && prev !== peerId) {
        ch.byPeer.delete(prev);
      }
      ch.conns.add(connId);
      if (peerId !== undefined && peerId !== "") {
        ch.byPeer.set(peerId, connId); // last-writer-wins (no-auth relay; peerId is a hint)
        ch.peerOf.set(connId, peerId);
      } else {
        ch.peerOf.delete(connId); // downgrade to broadcast-only: hold no route entry
      }
    },
    unsubscribe(connId: string, wsId: string): void {
      leave(connId, wsId);
    },
    publish(connId: string, wsId: string, payload: Uint8Array, toPeerId?: string): void {
      const ch = channels.get(wsId);
      // Pinned routing invariant (§3 "subscriber publishes"): publisher must be subscribed. This is a
      // routing rule, NOT an auth check (membership/allowlist is client-side).
      if (!ch || !ch.conns.has(connId)) {
        throw new Error(`publish: ${connId} is not subscribed to workspace ${wsId}`);
      }
      // The publisher's routing peerId rides the deliver so a responder can direct its reply at the
      // asker (§3c directed response). "" when the publisher declared no peerId (broadcast-only).
      const fromPeerId = ch.peerOf.get(connId) ?? "";
      if (toPeerId !== undefined && toPeerId !== "") {
        const target = ch.byPeer.get(toPeerId);
        if (target !== undefined && target !== connId) {
          peers.get(target)?.deliver(wsId, payload, fromPeerId);
        }
        return; // unknown / disconnected / self target → silent no-op (liveness is the client's job)
      }
      for (const id of ch.conns) {
        if (id === connId) {
          continue; // sender-exclusion (no echo)
        }
        peers.get(id)?.deliver(wsId, payload, fromPeerId);
      }
    },
    peers(wsId: string): string[] {
      const ch = channels.get(wsId);
      return ch ? [...ch.byPeer.keys()] : [];
    },
    isSubscribed(connId: string, wsId: string): boolean {
      return channels.get(wsId)?.conns.has(connId) ?? false;
    },
    disconnect(connId: string): void {
      peers.delete(connId);
      for (const wsId of channels.keys()) {
        leave(connId, wsId);
      }
    },
  };
}
