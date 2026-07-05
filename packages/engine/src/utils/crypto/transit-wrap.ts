import { hkdfSync } from "node:crypto";
import { x25519 } from "@noble/curves/ed25519";
import { aeadDecrypt, aeadEncrypt } from "./aes.js";

/**
 * Transit-key wrapping — seal a key to a peer's X25519 public, unseal with the peer's X25519
 * private scalar (design sync-identity-persistence §13). The transit key is wrapped per-peer so each
 * peer is independently revocable. Ephemeral X25519 + ECDH + HKDF-SHA256 + AES-256-GCM.
 *
 * Wrap blob = ephPub(32, raw) || AEAD(wrappingKey, key).
 */

const WRAP_INFO = Buffer.from("lode-membership-wrap-v1");
const EPH_PUBLIC_LEN = 32;

function deriveWrappingKey(shared: Uint8Array): Uint8Array {
  return Buffer.from(hkdfSync("sha256", Buffer.from(shared), Buffer.alloc(0), WRAP_INFO, 32));
}

/** Seal `key` (e.g. a transit key) to a peer's X25519 public. */
export function wrapKey(peerEncPub: Uint8Array, key: Uint8Array): Uint8Array {
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, peerEncPub);
  return Buffer.concat([
    Buffer.from(ephPub),
    Buffer.from(aeadEncrypt(deriveWrappingKey(shared), key)),
  ]);
}

/** Unseal a wrapped key with the peer's X25519 private scalar. Throws on a wrong peer / tamper. */
export function unwrapKey(peerEncPriv: Uint8Array, wrapped: Uint8Array): Uint8Array {
  const buf = Buffer.from(wrapped);
  if (buf.length < EPH_PUBLIC_LEN + 12 + 16) {
    throw new Error("wrapped key blob too short");
  }
  const ephPub = buf.subarray(0, EPH_PUBLIC_LEN);
  const blob = buf.subarray(EPH_PUBLIC_LEN);
  const shared = x25519.getSharedSecret(peerEncPriv, ephPub);
  return aeadDecrypt(deriveWrappingKey(shared), blob);
}
