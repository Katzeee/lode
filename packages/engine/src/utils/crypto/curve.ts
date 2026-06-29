import { ed25519 } from "@noble/curves/ed25519";

/**
 * Edwards↔Montgomery conversions — the Ed25519/X25519 dual-use map (design sync-identity-persistence
 * §3): one Ed25519 actor key also backs X25519 ECDH. `node:crypto` exposes no Edwards→Montgomery API,
 * so this uses @noble/curves. Generic curve operations, no actor semantics — the actor-typed wrappers
 * (`actorEncryptionPublic`/`actorEncryptionPrivate`) live in `identity/actor-encryption.ts`.
 */

/** Ed25519 public key (32B) → X25519 public key (32B, Montgomery u). */
export function edwardsToMontgomeryPub(ed25519Pub: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomery(Buffer.from(ed25519Pub));
}

/** Ed25519 private SEED (32B) → X25519 private scalar (32B). */
export function edwardsToMontgomeryPriv(ed25519Seed: Uint8Array): Uint8Array {
  return ed25519.utils.toMontgomerySecret(Buffer.from(ed25519Seed));
}
