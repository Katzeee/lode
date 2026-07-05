import { x25519 } from "@noble/curves/ed25519";

/**
 * The peer key — a random X25519 keypair, one per dataRoot, persisted alongside peerId (design
 * sync-identity-persistence §13). It is the transit-wrap TARGET: the owner wraps the transit key to
 * the peer's X25519 public, and the peer unwraps with its private scalar. It NEVER signs (the
 * actor key signs everything); it exists only so each peer is independently revocable — `rotate`
 * omitting its peerId cuts it (no unwrap → no transit → no read/write).
 *
 * It is NOT mnemonic-derived. A lost/compromised mnemonic must not let a revoked peer re-derive its
 * key, so the peer key is random and persisted at rest (per-dataRoot).
 *
 * Pure leaf: @noble/curves only.
 */

/** A peer X25519 keypair. `privateKey` is the 32-byte secret scalar; `publicKey` the 32-byte X25519 public. */
export type PeerKeypair = {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
};

const SCALAR_LEN = 32;

/** Generate a fresh random peer keypair. */
export function generatePeerKeypair(): PeerKeypair {
  const privateKey = x25519.utils.randomSecretKey();
  return { publicKey: x25519.getPublicKey(privateKey), privateKey };
}

/** Reconstruct a peer keypair from its private scalar (the public is deterministic from the
 *  private in X25519). Used to load a persisted peer key. Throws on a wrong-length scalar. */
export function peerKeypairFromPrivateKey(privateKey: Uint8Array): PeerKeypair {
  if (privateKey.length !== SCALAR_LEN) {
    throw new Error(`peer private key must be ${SCALAR_LEN} bytes (got ${privateKey.length})`);
  }
  return { privateKey: new Uint8Array(privateKey), publicKey: x25519.getPublicKey(privateKey) };
}
