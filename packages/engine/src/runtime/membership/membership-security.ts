import { type MembershipLog, type MembershipState, type LocalPeer } from "./membership-log.js";
import { actorHasPeer } from "./membership-replay.js";
import { actorPublicKeyFromId } from "../../utils/crypto/index.js";
import type { WireSecurity } from "./wire-security.js";

export type MembershipWireSecurity = {
  /** The live `WireSecurity` to hand to a secured `BrokerSyncProtocol`. Its `transitKey` field
   *  is mutated in place by `refresh()` — the transport sees the new key without being rebuilt. */
  readonly security: WireSecurity;
  /** Re-derive the membership snapshot from the log and, if the local peer is admitted, install the
   *  unwrapped transit key onto `security`. Call after each membership-gossip round so the key + member
   *  set reflect the latest converged roster. */
  refresh(): void;
  /** True iff the local peer (peerId) is currently admitted → the sealed content round may run. */
  isMember(): boolean;
  /** The latest converged membership state (refreshed by `refresh()`). */
  state(): MembershipState;
};

/**
 * Build a `WireSecurity` for a content transport from a membership log + the local peer (design
 * sync-identity-persistence §2 + §13). `refresh()` re-derives the log state and installs the unwrapped
 * transit key onto `security.transitKey` (a concrete, mutable field — the crypto layer just AEADs
 * under whatever it holds, no membership knowledge). Before the local peer is admitted the key stays
 * a placeholder and `isMember()` is false, so the host skips the sealed content round; the membership
 * (plaintext) round still runs, which is exactly what lets the peer join.
 *
 * The actor still signs every wire payload (attribution); the peer key only unwraps transit. A
 * sender's sign pub is recovered from its actorId; `resolveActorPub` is a SOFT membership-attribution
 * gate (the actor must own ≥1 admitted peer). The HARD exclude of a revoked peer — which still
 * holds the actor signing key — is the AEAD gate under the receiver's current transit key in `open()`:
 * a revoked peer cannot unwrap the new transit, so its sealed blobs fail AEAD on every current peer.
 *
 * Reusable by both the daemon (`DaemonSyncRunner`) and an in-process mobile host that dials a relay
 * directly: the same three pieces (membership log + this security + `BrokerSyncProtocol`).
 */
export function createMembershipWireSecurity(opts: {
  log: MembershipLog;
  local: LocalPeer;
}): MembershipWireSecurity {
  const { log, local } = opts;
  const snap = { state: log.deriveState().state };
  const security: WireSecurity = {
    actorId: local.actor.actorId,
    actorPrivateKey: local.actor.privateKey,
    // Placeholder until refresh() installs the real key; never used as a real key because the host
    // gates sealed rounds on isMember(), which is true only once a real key has been installed.
    transitKey: new Uint8Array(32),
    resolveActorPub: (id) => {
      if (!actorHasPeer(snap.state, id)) {
        return undefined;
      }
      try {
        return actorPublicKeyFromId(id);
      } catch {
        return undefined;
      }
    },
  };
  return {
    security,
    refresh: () => {
      const { state } = log.deriveState();
      snap.state = state;
      if (state.peers.has(local.peerId)) {
        security.transitKey = log.unwrapCurrentTransitKey(state, local);
      }
    },
    isMember: () => snap.state.peers.has(local.peerId),
    state: () => snap.state,
  };
}
