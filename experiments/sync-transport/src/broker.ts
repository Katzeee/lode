/**
 * P6 — the workspace-routing BROKER (design §3). The production relay's core routing layer: clients
 * subscribe workspaces; the broker routes each publish to that workspace's subscribers (minus the
 * sender). This is the layer P0–P5 did NOT cover — they were pairwise. The broker is:
 *   - **routing-aware** — a subscription table `Map<wsId, Set<clientId>>`; routes per-workspace.
 *   - **content-blind** — the payload is opaque bytes; the broker never decodes. With a cipher
 *     (§5, `makeAesGcmCipher`), clients pre-encrypt and the broker forwards ciphertext.
 *   - **no-auth** — it does not check MEMBERSHIP (clients enforce allowlists, P4). Pinned policy:
 *     the publisher must be SUBSCRIBED to the workspace (a routing invariant matching §3
 *     "subscriber publishes", not an auth check); a non-subscriber publish throws.
 *   - **no content storage** — it forwards, never persists workspace content (§2).
 *
 * Playground-minimal: a pure in-process routing function (synchronous deliver). Real sockets are an
 * adapter around this core, not needed to prove the routing contract.
 */

export type BrokerClient = {
  readonly id: string;
  /** Broker → client: deliver a routed frame. The client owns its received-log. */
  deliver(wsId: string, payload: Uint8Array): void;
};

export type BrokerStateSummary = {
  /** Sorted workspace ids with ≥1 subscriber. */
  workspaces: string[];
  /** wsId → sorted subscriber client ids. */
  subscribers: Record<string, string[]>;
  /** Bytes currently in-flight (drains to 0 between publishes — deliver is synchronous). */
  inflightBufferSize: number;
};

export type Broker = {
  connect(client: BrokerClient): void;
  subscribe(clientId: string, wsId: string): void;
  unsubscribe(clientId: string, wsId: string): void;
  /** Route `payload` to subscribers(wsId) minus the sender. Throws if sender ∉ subscribers(wsId). */
  publish(senderId: string, wsId: string, payload: Uint8Array): void;
  /** Test-only: the voluntarily-exposed state summary (no-content-storage oracle). */
  stateSummary(): BrokerStateSummary;
  /** Test-only: every payload submitted to `publish` (logged once per publish, not per-recipient —
   *  the content-blind oracle checks the plaintext sentinel never appears in what the broker was
   *  handed, which holds regardless of recipient count). */
  forwardedBytes(): Uint8Array;
  disconnect(clientId: string): void;
};

export function createBroker(): Broker {
  const clients = new Map<string, BrokerClient>();
  const subs = new Map<string, Set<string>>(); // wsId → subscriber client ids
  const forwarded: Buffer[] = [];

  return {
    connect(client: BrokerClient): void {
      clients.set(client.id, client);
    },
    subscribe(clientId: string, wsId: string): void {
      let set = subs.get(wsId);
      if (!set) {
        set = new Set();
        subs.set(wsId, set);
      }
      set.add(clientId);
    },
    unsubscribe(clientId: string, wsId: string): void {
      subs.get(wsId)?.delete(clientId);
    },
    publish(senderId: string, wsId: string, payload: Uint8Array): void {
      const recipients = subs.get(wsId);
      // Pinned policy (§3 "subscriber publishes"): publisher must be subscribed. This is a routing
      // invariant, NOT auth (membership/allowlist is client-side, P4).
      if (!recipients || !recipients.has(senderId)) {
        throw new Error(`publish: ${senderId} is not subscribed to workspace ${wsId}`);
      }
      forwarded.push(Buffer.from(payload)); // the broker "touched" this payload (content-blind oracle)
      for (const cid of recipients) {
        if (cid === senderId) {
          continue; // sender-exclusion (no echo)
        }
        clients.get(cid)?.deliver(wsId, payload);
      }
    },
    stateSummary(): BrokerStateSummary {
      const subscribers: Record<string, string[]> = {};
      const workspaces: string[] = [];
      for (const [wsId, set] of subs) {
        if (set.size > 0) {
          workspaces.push(wsId);
          subscribers[wsId] = [...set].sort();
        }
      }
      workspaces.sort();
      return { workspaces, subscribers, inflightBufferSize: 0 };
    },
    forwardedBytes(): Uint8Array {
      return new Uint8Array(Buffer.concat(forwarded));
    },
    disconnect(clientId: string): void {
      clients.delete(clientId);
      for (const set of subs.values()) {
        set.delete(clientId);
      }
    },
  };
}
