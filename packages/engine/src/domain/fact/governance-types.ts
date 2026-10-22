import type { ActorId } from "./fact-value-types.js";

/**
 * Governance Fact vocabulary: workspace establish, Actor membership, and Peer
 * admission ride the same Fact authority as content. Byte-valued fields are
 * base64 strings so Facts stay canonical-JSON serializable. Actor and Peer
 * identities encode their own public keys, so membership records carry ids
 * only; the transit key itself never appears — only per-peer envelopes sealed
 * to one Peer's X25519 public key.
 */

export type PeerId = string;

/** A transit key sealed to exactly one Peer's X25519 public key. */
export type TransitEnvelope = Readonly<{
  /** Raw 32-byte ephemeral X25519 public key, base64. */
  readonly ephemeral: string;
  /** AEAD blob (nonce‖ciphertext‖tag), base64. */
  readonly seal: string;
}>;

export type GovernanceAction =
  | Readonly<{ kind: "workspace-establish"; ownerActorId: ActorId }>
  | Readonly<{ kind: "actor-admit"; actorId: ActorId }>
  | Readonly<{ kind: "actor-remove"; actorId: ActorId }>
  | Readonly<{ kind: "owner-transfer"; nextOwnerActorId: ActorId }>
  | Readonly<{
      kind: "peer-admit";
      peerId: PeerId;
      peerKxPublicKey: string;
      envelope: TransitEnvelope;
      epoch: number;
    }>
  | Readonly<{
      kind: "transit-rotate";
      epoch: number;
      peers: readonly Readonly<{ peerId: PeerId; envelope: TransitEnvelope }>[];
    }>;

export type GovernanceBody = Readonly<{
  kind: "governance";
  actorId: ActorId;
  action: GovernanceAction;
}>;
