import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  sign as signWithNode,
  verify as verifyWithNode,
} from "node:crypto";

/**
 * Raw key material handling for the identity substrate. Keys live as raw
 * 32-byte seeds/public keys; DER prefixes reconstruct Node KeyObjects on
 * demand so nothing outside this module knows a KeyObject or a wire format.
 */

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

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
  return copy(signWithNode(null, Buffer.from(message), ed25519PrivateKey(seed)));
}

/** Constant-shape verification: malformed input is a mismatch, never a crash. */
export function verifyBytes(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  if (publicKey.length !== PUBLIC_KEY_LENGTH || signature.length !== 64) {
    return false;
  }
  try {
    return verifyWithNode(null, Buffer.from(message), ed25519PublicKey(publicKey), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Raw X25519 shared secret between an ephemeral secret and a peer public key. */
export function exchangeSecret(secret: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  if (peerPublicKey.length !== PUBLIC_KEY_LENGTH) {
    throw new Error("X25519 public key must be 32 bytes");
  }
  return copy(diffieHellman({ privateKey: x25519PrivateKey(secret), publicKey: x25519PublicKey(peerPublicKey) }));
}

/** A one-shot ephemeral X25519 public key for sealing to a recipient. */
export function ephemeralExchangeKeyPair(): ExchangeKeyPair {
  const pair = generateKeyPairSync("x25519");
  return {
    secret: pair.privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32),
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).subarray(-PUBLIC_KEY_LENGTH),
  };
}

export function ed25519PublicFromSeed(seed: Uint8Array): Uint8Array {
  const pair = signingKeyPairFromSeedUnsafe(seed);
  return copy(createPublicKey(pair.privateKey).export({ type: "spki", format: "der" }).subarray(-PUBLIC_KEY_LENGTH));
}

export function x25519PublicFromSecret(secret: Uint8Array): Uint8Array {
  return copy(
    createPublicKey(x25519PrivateKey(secret)).export({ type: "spki", format: "der" }).subarray(-PUBLIC_KEY_LENGTH),
  );
}

function ed25519PrivateKey(seed: Uint8Array) {
  return createPrivateKey({ key: der(ED25519_PKCS8_PREFIX, seed), format: "der", type: "pkcs8" });
}

function ed25519PublicKey(publicKey: Uint8Array) {
  return createPublicKey({ key: der(ED25519_SPKI_PREFIX, publicKey), format: "der", type: "spki" });
}

function x25519PrivateKey(secret: Uint8Array) {
  return createPrivateKey({ key: der(X25519_PKCS8_PREFIX, secret), format: "der", type: "pkcs8" });
}

function x25519PublicKey(publicKey: Uint8Array) {
  return createPublicKey({ key: der(X25519_SPKI_PREFIX, publicKey), format: "der", type: "spki" });
}

function signingKeyPairFromSeedUnsafe(seed: Uint8Array) {
  return { privateKey: ed25519PrivateKey(seed) };
}

function der(prefix: Buffer, raw: Uint8Array): Buffer {
  if (raw.length !== PUBLIC_KEY_LENGTH) {
    throw new Error("Key material must be 32 bytes");
  }
  return Buffer.concat([prefix, Buffer.from(raw)]);
}

function copy(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}
