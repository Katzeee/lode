import { type MembershipLog, type MembershipState } from "./membership-log.js";
import { type ActorKeypair } from "../../utils/crypto/index.js";
import type { WireSecurity } from "./wire-security.js";

export type MembershipWireSecurity = {
  /** The live `WireSecurity` to hand to a secured `BrokerClientSyncTransport`. Its `transitKey` field
   *  is mutated in place by `refresh()` — the transport sees the new key without being rebuilt. */
  readonly security: WireSecurity;
  /** Re-derive the membership snapshot from the log and, if the local actor is a member, install the
   *  unwrapped transit key onto `security`. Call after each membership-gossip round so the key + member
   *  set reflect the latest converged roster. */
  refresh(): void;
  /** True iff the local actor is currently a member → the sealed content round may run. */
  isMember(): boolean;
  /** The latest converged membership state (refreshed by `refresh()`). */
  state(): MembershipState;
};

/**
 * Build a `WireSecurity` for a content transport from a membership log + the local actor keypair
 * (design sync-identity-persistence §2). `refresh()` re-derives the log state and installs the
 * unwrapped transit key onto `security.transitKey` (a concrete, mutable field — the crypto layer just
 * AEADs under whatever it holds, no membership knowledge). Before the local actor is a member the key
 * stays a placeholder and `isMember()` is false, so the host skips the sealed content round; the
 * membership (plaintext) round still runs, which is exactly what lets the actor join.
 *
 * Reusable by both the daemon (`DaemonSyncRunner`) and an in-process mobile host that dials a relay
 * directly: the same three pieces (membership log + this security + `BrokerClientSyncTransport`).
 */
export function createMembershipWireSecurity(opts: {
  log: MembershipLog;
  keypair: ActorKeypair;
}): MembershipWireSecurity {
  const { log, keypair } = opts;
  const snap = { state: log.deriveState().state };
  const security: WireSecurity = {
    actorId: keypair.actorId,
    actorPrivateKey: keypair.privateKey,
    // Placeholder until refresh() installs the real key; never used as a real key because the host
    // gates sealed rounds on isMember(), which is true only once a real key has been installed.
    transitKey: new Uint8Array(32),
    resolveActorPub: (id) => snap.state.members.get(id)?.signPub,
  };
  return {
    security,
    refresh: () => {
      const { state } = log.deriveState();
      snap.state = state;
      if (state.members.has(keypair.actorId)) {
        security.transitKey = log.unwrapCurrentTransitKey(state, keypair);
      }
    },
    isMember: () => snap.state.members.has(keypair.actorId),
    state: () => snap.state,
  };
}
