import {
  createDecipheriv,
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

/**
 * Membership-log crypto — all `node:crypto`, no extra deps. An actor carries TWO keypairs:
 *   - Ed25519 (sign) — signs membership-log records; the actor's stable identity = hex of its
 *     raw pubkey. The owner's actor key is the governance signer; it does NOT rotate, so it is
 *     its own recovery anchor (self-signed root, no masterKey — design §2/§3).
 *   - X25519 (encrypt) — for transit-key wrapping (ECDH).
 * Production folds these into one Ed25519 key via Ed25519→Curve25519 conversion (F3b); the
 * playground uses two separate keypairs because the membership mechanics (wrapping, re-key
 * chain, replay, transfer) do not depend on the conversion.
 */

export type Actor = {
  /** Stable identity = hex of the raw Ed25519 public key (last 32 bytes of signPubSpki). */
  readonly actorId: string;
  readonly signPriv: KeyObject;
  /** Ed25519 SPKI DER (44B) — others verify this actor's signatures with it. */
  readonly signPubSpki: Uint8Array;
  readonly encPriv: KeyObject;
  /** X25519 SPKI DER (44B) — the transit key is wrapped (ECDH) to this. */
  readonly encPubSpki: Uint8Array;
};

const ED25519_RAW = 32;

export function generateActor(): Actor {
  const s = generateKeyPairSync("ed25519");
  const e = generateKeyPairSync("x25519");
  const signPubSpki = new Uint8Array(s.publicKey.export({ type: "spki", format: "der" }));
  const encPubSpki = new Uint8Array(e.publicKey.export({ type: "spki", format: "der" }));
  const actorId = Buffer.from(signPubSpki.subarray(signPubSpki.length - ED25519_RAW)).toString(
    "hex",
  );
  return { actorId, signPriv: s.privateKey, signPubSpki, encPriv: e.privateKey, encPubSpki };
}

/** A fresh per-epoch transit key (encrypts sync traffic in transit; design §2). */
export const newTransitKey = (): Uint8Array => randomBytes(32);

// ── AES-256-GCM AEAD (12B nonce + ct + 16B tag) — same shape as P5's makeAesGcmCipher ──

export function aeadEncrypt(key: Uint8Array, plain: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(key), iv);
  const ct = Buffer.concat([c.update(Buffer.from(plain)), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]);
}

export function aeadDecrypt(key: Uint8Array, blob: Uint8Array): Uint8Array {
  const buf = Buffer.from(blob);
  if (buf.length < 12 + 16) {
    throw new Error("aead blob too short");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const d = createDecipheriv("aes-256-gcm", Buffer.from(key), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

// ── Sealed-box transit-key wrapping: ephemeral X25519 + ECDH + HKDF-SHA256 + AES-256-GCM ─
// Only the holder of the recipient's encPriv can unwrap. Blob = ephPubSpki(44) || aead(wrappingKey, key).

const WRAP_INFO = Buffer.from("lode-membership-wrap-v1");
const SPKI_LEN = 44; // X25519 SPKI DER = 12-byte prefix + 32 raw

function deriveWrappingKey(shared: Buffer): Uint8Array {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), WRAP_INFO, 32));
}

export function wrapKey(recipientEncPubSpki: Uint8Array, key: Uint8Array): Uint8Array {
  const eph = generateKeyPairSync("x25519");
  const recip = createPublicKey({
    key: Buffer.from(recipientEncPubSpki),
    format: "der",
    type: "spki",
  });
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recip });
  const blob = aeadEncrypt(deriveWrappingKey(shared), key);
  const ephPubSpki = eph.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return Buffer.concat([ephPubSpki, blob]);
}

export function unwrapKey(recipientEncPriv: KeyObject, wrapped: Uint8Array): Uint8Array {
  const buf = Buffer.from(wrapped);
  if (buf.length < SPKI_LEN + 12 + 16) {
    throw new Error("wrapped key blob too short");
  }
  const ephPubSpki = buf.subarray(0, SPKI_LEN);
  const blob = buf.subarray(SPKI_LEN);
  const ephPub = createPublicKey({ key: ephPubSpki, format: "der", type: "spki" });
  const shared = diffieHellman({ privateKey: recipientEncPriv, publicKey: ephPub });
  return aeadDecrypt(deriveWrappingKey(shared), blob);
}

// ── Ed25519 sign / verify over arbitrary bytes ────────────────────────────────────────

export function signEd(signPriv: KeyObject, data: Uint8Array): Uint8Array {
  return new Uint8Array(sign(null, Buffer.from(data), signPriv));
}

export function verifyEd(signPubSpki: Uint8Array, data: Uint8Array, sig: Uint8Array): boolean {
  try {
    const pub = createPublicKey({ key: Buffer.from(signPubSpki), format: "der", type: "spki" });
    return verify(null, Buffer.from(data), pub, Buffer.from(sig));
  } catch {
    return false;
  }
}

export const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
export const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
