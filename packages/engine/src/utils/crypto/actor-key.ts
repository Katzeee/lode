import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { mnemonicToSeed, validateMnemonic } from "./bip39.js";
import { deriveEd25519Seed } from "./slip10.js";

/**
 * Actor identity signing core — a pure leaf (only `node:crypto` + sibling identity files). The actor
 * keypair is the membership/attribution principal (design sync-identity-persistence §3 + §13): an
 * Ed25519 keypair whose public key is the actor's stable identity. It can be generated at random OR
 * derived deterministically from a BIP-39 mnemonic (recovery/continuity: same words → same key; the
 * key does not rotate, so the same mnemonic re-derives the same owner on a new peer).
 *
 * The actor key is SIGNING-ONLY (wire attribution + governance + self-service-add). Transit-key
 * wrapping to a per-peer X25519 key lives in `transit-wrap.ts`; the Edwards↔Montgomery dual-use was
 * dropped (each peer has its own random X25519 key, never derived from this Ed25519 key). This
 * module owns signing, serialization, and mnemonic→seed→key derivation.
 */

const ED25519_RAW_LEN = 32;
// SPKI DER prefix for an Ed25519 public key: SEQUENCE { algid Ed25519, BIT STRING <raw> }.
// `302a300506032b6570032100` then the 32 raw key bytes.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
// PKCS8 DER prefix for an Ed25519 private key: 16-byte header, then the 32 raw seed bytes.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Raw 32-byte Ed25519 public key. */
export type ActorPublicKey = Uint8Array;
/** A node:crypto Ed25519 private KeyObject. */
export type ActorPrivateKey = KeyObject;

export type ActorKeypair = {
  /** Stable actor identity = hex of the raw Ed25519 public key. */
  readonly actorId: string;
  readonly publicKey: ActorPublicKey;
  readonly privateKey: ActorPrivateKey;
};

/** The actor's stable identity = hex of its raw Ed25519 public key. */
export function actorIdFromPublicKey(pub: ActorPublicKey): string {
  return Buffer.from(pub).toString("hex");
}

/** Recover the raw Ed25519 public key from an actorId — actorId is the hex of the pub, so this is the
 *  exact inverse of `actorIdFromPublicKey`. Used to verify a signer's signature from its actorId alone
 *  (membership records carry actorIds, not sign pubs). Throws on a malformed id. */
export function actorPublicKeyFromId(actorId: string): ActorPublicKey {
  const bytes = Buffer.from(actorId, "hex");
  if (bytes.length !== ED25519_RAW_LEN) {
    throw new Error(`actorId must be ${ED25519_RAW_LEN} hex-encoded bytes (got ${bytes.length})`);
  }
  return new Uint8Array(bytes);
}

/** Generate a fresh random Ed25519 actor keypair (random 32-byte seed). */
export function generateActorKeypair(): ActorKeypair {
  return keypairFromEd25519Seed(randomBytes(ED25519_RAW_LEN));
}

/** Build an Ed25519 keypair from a raw 32-byte seed (deterministic — the seed IS the key material). */
export function keypairFromEd25519Seed(seed: Uint8Array): ActorKeypair {
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  const pub = rawEd25519Public(publicKey);
  return { actorId: actorIdFromPublicKey(pub), publicKey: pub, privateKey };
}

/** Extract the 32-byte Ed25519 seed (private key material) from a private KeyObject. */
export function ed25519SeedFromPrivateKey(privateKey: ActorPrivateKey): Uint8Array {
  const der = new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" }));
  if (der.length !== ED25519_PKCS8_PREFIX.length + ED25519_RAW_LEN) {
    throw new Error(`expected ${ED25519_PKCS8_PREFIX.length + ED25519_RAW_LEN}-byte Ed25519 PKCS8`);
  }
  return new Uint8Array(der.subarray(der.length - ED25519_RAW_LEN));
}

/** Derive the actor keypair from a BIP-39 mnemonic (recovery/continuity). Throws on an invalid phrase. */
export function deriveActorKeypairFromMnemonic(mnemonic: string): ActorKeypair {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("invalid mnemonic");
  }
  return keypairFromEd25519Seed(deriveEd25519Seed(mnemonicToSeed(mnemonic)));
}

/** Sign `data` with the actor's Ed25519 private key → 64-byte signature. */
export function signWithActor(privateKey: ActorPrivateKey, data: Uint8Array): Uint8Array {
  return new Uint8Array(sign(null, Buffer.from(data), privateKey));
}

/** Verify `sig` against a raw Ed25519 public key. False on any malformed input (never throws). */
export function verifyActorSignature(
  pub: ActorPublicKey,
  data: Uint8Array,
  sig: Uint8Array,
): boolean {
  try {
    const key = createPublicKey({ key: publicKeyFromRaw(pub), format: "der", type: "spki" });
    return verify(null, Buffer.from(data), key, Buffer.from(sig));
  } catch {
    return false;
  }
}

// ── keystore serialization (PKCS8 DER for the private key) ───────────────────

/** Serialize the private key for at-rest storage (PKCS8 DER, 48 bytes for Ed25519). */
export function serializeActorPrivateKey(privateKey: ActorPrivateKey): Uint8Array {
  return new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" }));
}

/** Reconstruct a private key from PKCS8 DER bytes. Throws on malformed/non-Ed25519 input. */
export function deserializeActorPrivateKey(bytes: Uint8Array): ActorPrivateKey {
  const key = createPrivateKey({ key: Buffer.from(bytes), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`keystore key is not Ed25519 (got ${key.asymmetricKeyType ?? "unknown"})`);
  }
  return key;
}

// ── internals ────────────────────────────────────────────────────────────────

/** Extract the raw 32-byte Ed25519 public key from a KeyObject (SPKI DER = 12-byte prefix + raw). */
function rawEd25519Public(pub: KeyObject): ActorPublicKey {
  const spki = pub.export({ type: "spki", format: "der" });
  return new Uint8Array(spki.subarray(spki.length - ED25519_RAW_LEN));
}

/** Wrap a raw 32-byte Ed25519 public key back into SPKI DER for node:crypto verify APIs. */
function publicKeyFromRaw(raw: ActorPublicKey): Buffer {
  return Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(raw)]);
}
