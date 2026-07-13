import type { MembershipLog, LocalPeer } from "./membership-log.js";
import type { MembershipState } from "../../domain/membership/model.js";
import { actorHasPeer } from "../../domain/membership/replay.js";
import { actorPublicKeyFromId } from "../../crypto/index.js";
import type { WireSecurity } from "./wire-security.js";

export type MembershipWireSecurity = {
  /** The live `WireSecurity` to hand to a secured `BrokerSyncProtocol`. Its `transitKey` is a
   *  version-memoized getter: reading it re-derives the membership state (and the unwrapped key)
   *  iff the log's frontier has moved — so the transport always seals/opens under the current key
   *  with no external `refresh()` to remember. */
  readonly security: WireSecurity;
  /** True iff the local peer (peerId) is currently admitted → the sealed content round may run. */
  isMember(): boolean;
};

/**
 * Build a `WireSecurity` for a content transport from a membership log + the local peer (design
 * sync-identity-persistence §2 + §13). Wire security is a PROJECTION of the membership log: every
 * reader (`isMember`/`resolveActorPub`/`transitKey`) re-derives iff the log's frontier has
 * moved since the last read, else reuses the cached state + transit key. A projection invalidates
 * from its source — so any write (a governance rotate/add/revoke, or a sync import) is visible on
 * the very next read, with no `refresh()` for callers to remember to call.
 *
 * Before the local peer is admitted the key stays a placeholder and `isMember()` is false, so the
 * host skips the sealed content round; the membership (plaintext) round still runs, which is exactly
 * what lets the peer join.
 *
 * The actor still signs every wire payload (attribution); the peer key only unwraps transit. A
 * sender's sign pub is recovered from its actorId; `resolveActorPub` is a SOFT membership-attribution
 * gate (the actor must own ≥1 admitted peer). The HARD exclude of a revoked peer — which still
 * holds the actor signing key — is the AEAD gate under the receiver's current transit key in `open()`:
 * a revoked peer cannot unwrap the new transit, so its sealed blobs fail AEAD on every current peer.
 *
 * Reusable by the engine's sync sub-graph (the per-workspace `SyncContext`) and by
 * an in-process mobile host that dials a relay directly: the same three pieces (membership log +
 * this security + `BrokerSyncProtocol`).
 */
export function createMembershipWireSecurity(opts: {
  log: MembershipLog;
  local: LocalPeer;
}): MembershipWireSecurity {
  const { log, local } = opts;

  // The real transit key iff the local peer is currently admitted; a placeholder otherwise (never
  // used as a real key — the host gates sealed rounds on `isMember()`, true only once admitted).
  const unwrapTransitKey = (state: MembershipState): Uint8Array =>
    state.peers.has(local.peerId) ? log.unwrapCurrentTransitKey(state, local) : new Uint8Array(32);

  // Cached projection: state + the frontier key it was derived from. `ensureFresh` re-derives only
  // when the log's frontier (the causal heads) moves — which happens iff records were appended or
  // imported, i.e. iff the derived state could have changed.
  const snap = { state: log.deriveState().state, frontierKey: frontierKeyOf(log) };
  let currentTransitKey = unwrapTransitKey(snap.state);

  /** Re-derive the cached state + transit key iff the log moved since the last read. Called by every
   *  reader, so callers never need to remember a separate refresh step. */
  const ensureFresh = (): void => {
    const frontierKey = frontierKeyOf(log);
    if (frontierKey !== snap.frontierKey) {
      snap.state = log.deriveState().state;
      snap.frontierKey = frontierKey;
      currentTransitKey = unwrapTransitKey(snap.state);
    }
  };

  const security: WireSecurity = {
    actorId: local.actor.actorId,
    actorPrivateKey: local.actor.privateKey,
    // A getter, not a mutated field: reading the transit key (at every seal/open) lazily re-derives
    // when the log moved, so the transport always AEADs under the current key — including the push
    // fast-path, which seals without a membership gate.
    get transitKey(): Uint8Array {
      ensureFresh();
      return currentTransitKey;
    },
    resolveActorPub: (id) => {
      ensureFresh();
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
    isMember: () => {
      ensureFresh();
      return snap.state.peers.has(local.peerId);
    },
  };
}

/** A stable string for the log's current frontier — the membership-state version. Two equal keys
 *  mean the records are unchanged, so the derived state + transit key are unchanged. */
function frontierKeyOf(log: MembershipLog): string {
  return Buffer.from(log.metaDoc.frontiers()).toString("base64");
}
