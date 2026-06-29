import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM AEAD (12-byte nonce ‖ ciphertext ‖ 16-byte tag), node:crypto only. A generic shared
 * leaf: used by actor transit-key sealing (`identity/actor-encryption` wrap/unwrap), the membership-log
 * re-key chain (`enc_prev = AEAD(newTransitKey, oldTransitKey)`), and the sync wire-security layer
 * (`@lode/sync/wire-security`). Encryption is transport-only (design §2).
 */

/** Seal `plain` under `key`. Blob = nonce(12) ‖ ciphertext ‖ tag(16). */
export function aeadEncrypt(key: Uint8Array, plain: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]);
}

/** Open an AEAD blob. Throws on a wrong key or a tampered/tag-mismatched blob. */
export function aeadDecrypt(key: Uint8Array, blob: Uint8Array): Uint8Array {
  const buf = Buffer.from(blob);
  if (buf.length < 12 + 16) {
    throw new Error("aead blob too short");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(-16);
  const ct = buf.subarray(12, -16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
