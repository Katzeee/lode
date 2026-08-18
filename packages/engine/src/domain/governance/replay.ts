import { compareFacts, type Fact } from "../fact/index.js";
import type { ActorId, GovernanceAction, PeerId, TransitEnvelope } from "../fact/index.js";

/**
 * Deterministic governance replay. Membership and Peer admission are a pure
 * fold over governance Facts in the deterministic total order (Lamport, then
 * Replica, then sequence) — the same result on every replica regardless of
 * merge order. Facts whose authorization or epoch is stale are skipped: they
 * stay in the journal as evidence but have no governance effect. A second
 * workspace-establish is the one fatal input: it means two independently
 * created journals for one Workspace merged, which nothing downstream can
 * reconcile quietly.
 */

export type AdmittedPeer = Readonly<{
  peerId: PeerId;
  kxPublicKey: string;
  envelope: TransitEnvelope;
  admittedAtEpoch: number;
  admittedByActorId: ActorId;
}>;

export type GovernanceState = Readonly<{
  established: boolean;
  ownerActorId: ActorId | null;
  members: ReadonlySet<ActorId>;
  epoch: number;
  peers: ReadonlyMap<PeerId, AdmittedPeer>;
}>;

export const UNGOVERNED_STATE: GovernanceState = {
  established: false,
  ownerActorId: null,
  members: new Set(),
  epoch: -1,
  peers: new Map(),
};

export class DuplicateEstablishError extends Error {
  constructor(factId: string) {
    super(`Workspace already has an establish governance Fact: ${factId}`);
    this.name = "DuplicateEstablishError";
  }
}

export function projectGovernance(facts: readonly Fact[]): GovernanceState {
  const builder = new GovernanceStateBuilder();
  for (const fact of [...facts].sort(compareFacts)) {
    if (fact.body.kind !== "governance") {
      continue;
    }
    builder.apply(fact);
  }
  return builder.state();
}

/** Peers whose envelope matches the current transit epoch — the sync-admitted set. */
export function syncAdmittedPeers(state: GovernanceState): ReadonlyMap<PeerId, AdmittedPeer> {
  const admitted = new Map<PeerId, AdmittedPeer>();
  for (const [peerId, peer] of state.peers) {
    if (peer.admittedAtEpoch === state.epoch) {
      admitted.set(peerId, peer);
    }
  }
  return admitted;
}

class GovernanceStateBuilder {
  private established = false;
  private ownerActorId: ActorId | null = null;
  private readonly members = new Set<ActorId>();
  private epoch = -1;
  private readonly peers = new Map<PeerId, AdmittedPeer>();

  apply(fact: Fact): void {
    if (fact.body.kind !== "governance") {
      throw new Error("Governance replay received a non-governance Fact");
    }
    this.applyAction(fact.body.actorId, fact.body.action, fact.id);
  }

  state(): GovernanceState {
    return {
      established: this.established,
      ownerActorId: this.ownerActorId,
      members: this.members,
      epoch: this.epoch,
      peers: this.peers,
    };
  }

  private applyAction(actorId: ActorId, action: GovernanceAction, factId: string): void {
    switch (action.kind) {
      case "workspace-establish":
        if (this.established) {
          throw new DuplicateEstablishError(factId);
        }
        this.established = true;
        this.ownerActorId = action.ownerActorId;
        this.members.add(action.ownerActorId);
        this.epoch = 0;
        return;
      case "actor-admit":
        if (!this.established || actorId !== this.ownerActorId) {
          return;
        }
        this.members.add(action.actorId);
        return;
      case "actor-remove":
        if (!this.established || actorId !== this.ownerActorId || action.actorId === this.ownerActorId) {
          return;
        }
        this.members.delete(action.actorId);
        return;
      case "owner-transfer":
        if (
          !this.established ||
          actorId !== this.ownerActorId ||
          action.nextOwnerActorId === this.ownerActorId ||
          !this.members.has(action.nextOwnerActorId)
        ) {
          return;
        }
        this.ownerActorId = action.nextOwnerActorId;
        return;
      case "peer-admit":
        // Any member may vouch for a device; the envelope must target the
        // current epoch so a concurrent rotation retires the admission (staleAdd).
        if (!this.established || !this.members.has(actorId) || action.epoch !== this.epoch) {
          return;
        }
        this.peers.set(action.peerId, {
          peerId: action.peerId,
          kxPublicKey: action.peerKxPublicKey,
          envelope: action.envelope,
          admittedAtEpoch: action.epoch,
          admittedByActorId: actorId,
        });
        return;
      case "transit-rotate": {
        // Owner-only rotation. The roster is the admitted device set: peers
        // not listed lose admission and every listed peer gets the new key.
        if (!this.established || actorId !== this.ownerActorId || action.epoch !== this.epoch + 1) {
          return;
        }
        const listed = new Set(action.peers.map((entry) => entry.peerId));
        for (const peerId of [...this.peers.keys()]) {
          if (!listed.has(peerId)) {
            this.peers.delete(peerId);
          }
        }
        for (const entry of action.peers) {
          const existing = this.peers.get(entry.peerId);
          if (!existing) {
            continue;
          }
          this.peers.set(entry.peerId, {
            ...existing,
            envelope: entry.envelope,
            admittedAtEpoch: action.epoch,
          });
        }
        this.epoch = action.epoch;
      }
    }
  }
}
