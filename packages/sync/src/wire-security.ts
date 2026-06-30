import {
  aeadDecrypt,
  aeadEncrypt,
  signWithActor,
  verifyActorSignature,
  type ActorPrivateKey,
  type ActorPublicKey,
} from "@lode/engine";

/**
 * The wire security layer (design sync-design.md §5 + sync-identity-persistence §1): transit-key
 * AEAD + actor wire signing over every broker payload. The untrusted relay routes only ciphertext;
 * only members (who hold the transit key) can decrypt, and each payload is signed by its sender so a
 * forged or unknown signer is rejected even if it possessed the key.
 *
 * Sealed wire blob = `[actorIdLen:2 BE][actorId utf8][sig:64][aeadBlob]`, where `aeadBlob` =
 * `nonce(12) ‖ ciphertext ‖ tag(16)` (AES-256-GCM under the transit key) and `sig` is an Ed25519
 * signature over the PLAINTEXT. AEAD gives confidentiality + integrity; the signature gives
 * per-actor authenticity (attribution + sender-membership check via `resolveActorPub`).
 */

export type WireSealContext = {
  /** The current 32-byte workspace transit key. A concrete (mutable) field: a host installs a fresh
   *  key when the membership doc converges / a governance rotate lands, then `seal`/`open` AEAD under
   *  whatever key is currently held. The crypto layer does not know about membership lifecycle — the
   *  host gates sealed rounds on membership so this is never read before a real key is installed. */
  transitKey: Uint8Array;
  /** The sender's actor id (hex Ed25519 public). */
  readonly actorId: string;
  /** The sender's actor Ed25519 private key (signs outgoing payloads). */
  readonly actorPrivateKey: ActorPrivateKey;
};

export type WireOpenContext = {
  transitKey: Uint8Array;
  /** Resolve an actor id to its public key (member pubkeys); undefined → unknown sender → reject. */
  readonly resolveActorPub: (actorId: string) => ActorPublicKey | undefined;
};

/** Combined context a secured transport holds: signs outgoing (seal) + verifies incoming (open). */
export type WireSecurity = WireSealContext & {
  readonly resolveActorPub: (actorId: string) => ActorPublicKey | undefined;
};

const SIG_LEN = 64; // Ed25519 signature
const ACTORID_MAX = 0xffff;

/** Sign + AEAD-encrypt `plaintext` under the transit key → a sealed wire blob.
 *
 *  The `actorId` in the header is advisory/untrusted until `open()` resolves it to a known member
 *  pubkey and verifies the signature (the membership gate + signature IS the auth). It is visible to
 *  the relay (sender metadata) by design — the relay must route, and member actorIds are public. */
export function seal(ctx: WireSealContext, plaintext: Uint8Array): Uint8Array {
  const sig = signWithActor(ctx.actorPrivateKey, plaintext);
  const actorIdBytes = Buffer.from(ctx.actorId, "utf8");
  if (actorIdBytes.length > ACTORID_MAX) {
    throw new Error("wire-security: actorId too long");
  }
  const aeadBlob = aeadEncrypt(ctx.transitKey, plaintext);
  const head = Buffer.alloc(2);
  head.writeUInt16BE(actorIdBytes.length, 0);
  return Buffer.concat([head, actorIdBytes, Buffer.from(sig), Buffer.from(aeadBlob)]);
}

/** AEAD-decrypt + verify the sender's signature → the plaintext. Throws on any failure (wrong key,
 *  tamper, unknown actor, bad signature) — fail-closed. */
export function open(ctx: WireOpenContext, blob: Uint8Array): Uint8Array {
  const buf = Buffer.from(blob);
  if (buf.length < 2) {
    throw new Error("wire-security: blob too short");
  }
  const actorIdLen = buf.readUInt16BE(0);
  const actorIdEnd = 2 + actorIdLen;
  if (buf.length < actorIdEnd + SIG_LEN) {
    throw new Error("wire-security: blob truncated (actorId/sig)");
  }
  const actorId = buf.subarray(2, actorIdEnd).toString("utf8");
  const sig = new Uint8Array(buf.subarray(actorIdEnd, actorIdEnd + SIG_LEN));
  const aeadBlob = new Uint8Array(buf.subarray(actorIdEnd + SIG_LEN));
  const plaintext = aeadDecrypt(ctx.transitKey, aeadBlob); // throws on wrong key / tamper
  const pub = ctx.resolveActorPub(actorId);
  if (!pub) {
    throw new Error(`wire-security: unknown actor ${actorId}`);
  }
  if (!verifyActorSignature(pub, plaintext, sig)) {
    throw new Error(`wire-security: bad signature from ${actorId}`);
  }
  return plaintext;
}
