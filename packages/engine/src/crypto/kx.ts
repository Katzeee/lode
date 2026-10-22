import { deriveContentKey, aeadOpen, aeadSeal } from "./aead.js";
import { ephemeralExchangeKeyPair, exchangeSecret, PUBLIC_KEY_LENGTH } from "./keys.js";

/**
 * Public-key sealing of a symmetric secret to exactly one recipient's X25519
 * public key. Layout: ephPublic(32) ‖ AEAD(HKDF(shared, salt=zeros, info)),
 * so a sealed secret can be produced without knowing the recipient and opened
 * only by the holder of the recipient secret.
 */

const HKDF_SALT = new Uint8Array(32);
const HKDF_INFO = "lode-transit-envelope-v1";
const EPHEMERAL_LENGTH = PUBLIC_KEY_LENGTH;

export function sealToPublicKey(secret: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (recipientPublicKey.length !== PUBLIC_KEY_LENGTH) {
    throw new Error("Sealing target public key must be 32 bytes");
  }
  const ephemeral = ephemeralExchangeKeyPair();
  const shared = exchangeSecret(ephemeral.secret, recipientPublicKey);
  const sealed = aeadSeal(deriveContentKey(shared, HKDF_SALT, HKDF_INFO), secret);
  return new Uint8Array([...ephemeral.publicKey, ...sealed]);
}

export function openWithSecret(envelope: Uint8Array, recipientSecret: Uint8Array): Uint8Array {
  if (envelope.length <= EPHEMERAL_LENGTH) {
    throw new Error("Transit envelope is truncated");
  }
  const ephemeralPublic = envelope.subarray(0, EPHEMERAL_LENGTH);
  const shared = exchangeSecret(recipientSecret, ephemeralPublic);
  return aeadOpen(deriveContentKey(shared, HKDF_SALT, HKDF_INFO), envelope.subarray(EPHEMERAL_LENGTH));
}
