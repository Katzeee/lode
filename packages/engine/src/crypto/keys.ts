import { ed25519, x25519 } from "@noble/curves/ed25519.js";

import { randomBytes } from "./random.js";

/**
 * Raw key material handling for the identity substrate. Keys live as raw
 * 32-byte seeds/public keys, independent of a platform key-object format.
 */

export const PUBLIC_KEY_LENGTH = 32;

export type SigningKeyPair = Readonly<{
  /** Raw 32-byte Ed25519 seed — the recoverable private material. */
  readonly seed: Uint8Array;
  /** Raw 32-byte Ed25519 public key. */
  readonly publicKey: Uint8Array;
}>;

export type ExchangeKeyPair = Readonly<{
  /** Raw 32-byte X25519 secret scalar. */
  readonly secret: Uint8Array;
  /** Raw 32-byte X25519 public key. */
  readonly publicKey: Uint8Array;
}>;

export function generateSigningKeyPair(): SigningKeyPair {
  return signingKeyPairFromSeed(randomBytes(PUBLIC_KEY_LENGTH));
}

export function signingKeyPairFromSeed(seed: Uint8Array): SigningKeyPair {
  return { seed: copy(seed), publicKey: ed25519PublicFromSeed(seed) };
}

export function generateExchangeKeyPair(): ExchangeKeyPair {
  const secret = randomBytes(PUBLIC_KEY_LENGTH);
  return { secret: copy(secret), publicKey: x25519PublicFromSecret(secret) };
}

export function signBytes(message: Uint8Array, seed: Uint8Array): Uint8Array {
  assertKeyMaterial(seed);
  return copy(ed25519.sign(message, seed));
}

/** Length-invalid inputs and cryptographic mismatches are ordinary verification failures. */
export function verifyBytes(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  if (publicKey.length !== PUBLIC_KEY_LENGTH || signature.length !== 64) {
    return false;
  }
  return ed25519.verify(signature, message, publicKey);
}

/** Raw X25519 shared secret between an ephemeral secret and a peer public key. */
export function exchangeSecret(secret: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  if (peerPublicKey.length !== PUBLIC_KEY_LENGTH) {
    throw new Error("X25519 public key must be 32 bytes");
  }
  assertKeyMaterial(secret);
  return copy(x25519.getSharedSecret(secret, peerPublicKey));
}

/** A one-shot ephemeral X25519 public key for sealing to a recipient. */
export function ephemeralExchangeKeyPair(): ExchangeKeyPair {
  return generateExchangeKeyPair();
}

export function ed25519PublicFromSeed(seed: Uint8Array): Uint8Array {
  assertKeyMaterial(seed);
  return copy(ed25519.getPublicKey(seed));
}

export function x25519PublicFromSecret(secret: Uint8Array): Uint8Array {
  assertKeyMaterial(secret);
  return copy(x25519.getPublicKey(secret));
}

function assertKeyMaterial(raw: Uint8Array): void {
  if (raw.length !== PUBLIC_KEY_LENGTH) {
    throw new Error("Key material must be 32 bytes");
  }
}

function copy(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}
