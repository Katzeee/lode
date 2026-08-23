import { PUBLIC_KEY_LENGTH } from "./keys.js";

/**
 * Identity encodings. An Actor id is the hex Ed25519 public key; a Peer id is
 * the hex Ed25519 identity public key — both prefixed so the kind and the
 * verifying key are recoverable from the id alone. This is what lets Fact
 * governance records carry ids without a key registry.
 */

const ACTOR_PREFIX = "actor_";
const PEER_PREFIX = "peer_";
const HEX_LENGTH = PUBLIC_KEY_LENGTH * 2;
const HEX_PATTERN = /^[0-9a-f]+$/;

export function actorIdFromPublicKey(publicKey: Uint8Array): string {
  return `${ACTOR_PREFIX}${toHex(publicKey)}`;
}

export function peerIdFromPublicKey(publicKey: Uint8Array): string {
  return `${PEER_PREFIX}${toHex(publicKey)}`;
}

/** Raw public key behind a Peer id, or null when the id is not well-formed. */
export function peerPublicKeyFromId(peerId: string): Uint8Array | null {
  return publicKeyFromId(peerId, PEER_PREFIX);
}

export function isActorId(value: string): boolean {
  return publicKeyFromId(value, ACTOR_PREFIX) !== null;
}

export function isPeerId(value: string): boolean {
  return publicKeyFromId(value, PEER_PREFIX) !== null;
}

function publicKeyFromId(value: string, prefix: string): Uint8Array | null {
  if (!value.startsWith(prefix)) {
    return null;
  }
  const hex = value.slice(prefix.length);
  if (hex.length !== HEX_LENGTH || !HEX_PATTERN.test(hex)) {
    return null;
  }
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function toHex(publicKey: Uint8Array): string {
  if (publicKey.length !== PUBLIC_KEY_LENGTH) {
    throw new Error("Public key must be 32 bytes");
  }
  return Buffer.from(publicKey).toString("hex");
}
