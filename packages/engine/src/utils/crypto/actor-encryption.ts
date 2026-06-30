import { hkdfSync } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519";
import { aeadDecrypt, aeadEncrypt } from "./aes.js";
import { edwardsToMontgomeryPriv, edwardsToMontgomeryPub } from "./curve.js";
import {
  ed25519SeedFromPrivateKey,
  type ActorPrivateKey,
  type ActorPublicKey,
} from "./actor-key.js";

/**
 * The encryption half of actor dual-use (design sync-identity-persistence §3): one Ed25519 actor key
 * also backs X25519 ECDH — the any-sync dual-use trick. A member's X25519 public is derived from their
 * Ed25519 public so the owner can WRAP the transit key to them; the member UNWRAPs with the X25519
 * private derived from their Ed25519 seed. The generic Edwards↔Montgomery map lives in `curve.ts`;
 * the AES-256-GCM primitive in `aes.ts`. This module owns the actor-typed wrappers + the sealed-box
 * (ephemeral X25519 + ECDH + HKDF-SHA256 + AES-256-GCM).
 *
 * Wrap blob = ephPub(32, raw) || AEAD(wrappingKey, key).
 */

const WRAP_INFO = Buffer.from("lode-membership-wrap-v1");
const EPH_PUBLIC_LEN = 32;

/** X25519 public for an actor (Ed25519 pub → Montgomery). Used to WRAP a key TO this actor. */
export function actorEncryptionPublic(ed25519Pub: ActorPublicKey): Uint8Array {
  return edwardsToMontgomeryPub(ed25519Pub);
}

/** X25519 private scalar for an actor (from the Ed25519 seed). Used to UNWRAP a key held by this actor. */
export function actorEncryptionPrivate(privateKey: ActorPrivateKey): Uint8Array {
  return edwardsToMontgomeryPriv(ed25519SeedFromPrivateKey(privateKey));
}

function deriveWrappingKey(shared: Uint8Array): Uint8Array {
  return Buffer.from(hkdfSync("sha256", Buffer.from(shared), Buffer.alloc(0), WRAP_INFO, 32));
}

/** Seal `key` (e.g. a transit key) to a recipient's X25519 public. */
export function wrapKey(recipientEncPub: Uint8Array, key: Uint8Array): Uint8Array {
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, recipientEncPub);
  return Buffer.concat([
    Buffer.from(ephPub),
    Buffer.from(aeadEncrypt(deriveWrappingKey(shared), key)),
  ]);
}

/** Unseal a wrapped key with the recipient's X25519 private scalar. Throws on a wrong recipient. */
export function unwrapKey(recipientEncPriv: Uint8Array, wrapped: Uint8Array): Uint8Array {
  const buf = Buffer.from(wrapped);
  if (buf.length < EPH_PUBLIC_LEN + 12 + 16) {
    throw new Error("wrapped key blob too short");
  }
  const ephPub = buf.subarray(0, EPH_PUBLIC_LEN);
  const blob = buf.subarray(EPH_PUBLIC_LEN);
  const shared = x25519.getSharedSecret(recipientEncPriv, ephPub);
  return aeadDecrypt(deriveWrappingKey(shared), blob);
}
