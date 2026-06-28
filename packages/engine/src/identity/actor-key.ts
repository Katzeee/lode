import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

/**
 * Actor identity crypto — a pure leaf (only `node:crypto`, no engine imports). The actor
 * keypair is the membership/attribution principal (design sync-identity-persistence §3):
 * an Ed25519 keypair whose public key is the actor's stable identity, used to SIGN ACL
 * records / sync updates. Ed25519→X25519 conversion (to also ENCRYPT — wrapping read-keys
 * to a member's actor pubkey) and BIP-39/SLIP-10 mnemonic recovery land with the ACL work
 * (P7/A1); this leaf is the dependency-free signing core that F4 (session auth), A1 (ACL
 * signing), and the keystore need first.
 */

const ED25519_RAW_LEN = 32;
// SPKI DER prefix for an Ed25519 public key: SEQUENCE { algid Ed25519, BIT STRING <raw> }.
// `302a300506032b6570032100` then the 32 raw key bytes.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

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

/** Generate a fresh random Ed25519 actor keypair. */
export function generateActorKeypair(): ActorKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = rawEd25519Public(publicKey);
  return { actorId: actorIdFromPublicKey(pub), publicKey: pub, privateKey };
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

/** Reconstruct a private key from PKCS8 DER bytes. Throws on malformed input. */
export function deserializeActorPrivateKey(bytes: Uint8Array): ActorPrivateKey {
  return createPrivateKey({ key: Buffer.from(bytes), format: "der", type: "pkcs8" });
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
