import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

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
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final(), cipher.getAuthTag()]);
  return new Uint8Array(Buffer.concat([nonce, ciphertext]));
}

export function aeadOpen(key: Uint8Array, blob: Uint8Array): Uint8Array {
  assertKey(key);
  if (blob.length < NONCE_LENGTH + TAG_LENGTH) {
    throw new Error("Sealed blob is truncated");
  }
  const nonce = Buffer.from(blob.subarray(0, NONCE_LENGTH));
  const ciphertext = Buffer.from(blob.subarray(NONCE_LENGTH, blob.length - TAG_LENGTH));
  const tag = Buffer.from(blob.subarray(blob.length - TAG_LENGTH));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), nonce);
  decipher.setAuthTag(tag);
  const opened = decipher.update(ciphertext);
  try {
    return new Uint8Array(Buffer.concat([opened, decipher.final()]));
  } catch {
    // With a validated key and fixed GCM shape, final() rejects only when the
    // authentication tag does not match the ciphertext.
    throw new AeadAuthenticationError();
  }
}

/** HKDF-SHA256 over a shared secret into a 32-byte content key. */
export function deriveContentKey(sharedSecret: Uint8Array, salt: Uint8Array, info: string): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", Buffer.from(sharedSecret), Buffer.from(salt), Buffer.from(info), KEY_LENGTH),
  );
}

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error("AEAD key must be 32 bytes");
  }
}
