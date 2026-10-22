import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { randomBytes } from "./random.js";

/**
 * Authenticated encryption for identity-bearing material: the transit key
 * envelope, vault entries, and sealed sync payloads. Every blob carries its
 * own random 12-byte nonce; the 16-byte GCM tag is appended to the ciphertext.
 */

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class AeadAuthenticationError extends Error {
  constructor() {
    super("Sealed blob failed authentication");
    this.name = "AeadAuthenticationError";
  }
}

export function aeadSeal(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  assertKey(key);
  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertextAndTag = gcm(key, nonce).encrypt(plaintext);
  const sealed = new Uint8Array(nonce.length + ciphertextAndTag.length);
  sealed.set(nonce);
  sealed.set(ciphertextAndTag, nonce.length);
  return sealed;
}

export function aeadOpen(key: Uint8Array, blob: Uint8Array): Uint8Array {
  assertKey(key);
  if (blob.length < NONCE_LENGTH + TAG_LENGTH) {
    throw new Error("Sealed blob is truncated");
  }
  try {
    return gcm(key, blob.subarray(0, NONCE_LENGTH)).decrypt(blob.subarray(NONCE_LENGTH));
  } catch {
    throw new AeadAuthenticationError();
  }
}

/** HKDF-SHA256 over a shared secret into a 32-byte content key. */
export function deriveContentKey(sharedSecret: Uint8Array, salt: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, sharedSecret, salt, new TextEncoder().encode(info), KEY_LENGTH);
}

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error("AEAD key must be 32 bytes");
  }
}
