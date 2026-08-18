import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  ed25519PublicFromSeed,
  generateExchangeKeyPair,
  generateSigningKeyPair,
  peerIdFromPublicKey,
  signBytes,
  verifyBytes,
  x25519PublicFromSecret,
  type ExchangeKeyPair,
  type SigningKeyPair,
} from "../../crypto/index.js";

/**
 * The Home's Peer identity: one persistent device identity per data root,
 * independent of every Actor. The Ed25519 identity key proves the Peer's id to
 * remote sync boundaries; the X25519 key opens transit envelopes. This store
 * is deliberately not passphrase-encrypted — background replica exchange must
 * survive daemon restarts with the Actor Vault locked.
 */

const PEER_FILE_VERSION = 1;

export type PeerMaterial = Readonly<{
  peerId: string;
  identity: SigningKeyPair;
  exchange: ExchangeKeyPair;
}>;

type PeerFile = Readonly<{
  version: number;
  peerId: string;
  identitySeed: string;
  exchangeSecret: string;
}>;

/** Signs a remote-boundary challenge: the peer's proof of id possession. */
export function signPeerChallenge(material: PeerMaterial, challenge: Uint8Array): Uint8Array {
  return signBytes(challenge, material.identity.seed);
}

export function verifyPeerChallenge(
  peerId: string,
  challenge: Uint8Array,
  signature: Uint8Array,
  identityPublicKey: Uint8Array,
): boolean {
  return peerIdFromPublicKey(identityPublicKey) === peerId && verifyBytes(challenge, signature, identityPublicKey);
}

export async function loadOrCreatePeerMaterial(file: string | undefined): Promise<PeerMaterial> {
  if (file !== undefined) {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!isPeerFile(parsed)) {
        throw new Error(`Peer identity is corrupt: ${file}`);
      }
      return materialFromFile(parsed);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw new Error(`Cannot load Peer identity: ${file}`, { cause: error });
      }
    }
  }
  const material = createPeerMaterial();
  if (file !== undefined) {
    await persistPeerMaterial(file, material);
  }
  return material;
}

export function createPeerMaterial(): PeerMaterial {
  const identity = generateSigningKeyPair();
  const exchange = generateExchangeKeyPair();
  return { peerId: peerIdFromPublicKey(identity.publicKey), identity, exchange };
}

// ponytail: recompute publics from seeds rather than storing them, so the file
// can never disagree with its own secrets.
function materialFromFile(file: PeerFile): PeerMaterial {
  const identitySeed = new Uint8Array(Buffer.from(file.identitySeed, "hex"));
  const exchangeSecret = new Uint8Array(Buffer.from(file.exchangeSecret, "hex"));
  if (identitySeed.length !== 32 || exchangeSecret.length !== 32) {
    throw new Error("Peer identity material is corrupt");
  }
  const identity = { seed: identitySeed, publicKey: ed25519PublicFromSeed(identitySeed) };
  if (peerIdFromPublicKey(identity.publicKey) !== file.peerId) {
    throw new Error("Peer identity material is corrupt");
  }
  return {
    peerId: file.peerId,
    identity,
    exchange: { secret: exchangeSecret, publicKey: x25519PublicFromSecret(exchangeSecret) },
  };
}

async function persistPeerMaterial(file: string, material: PeerMaterial): Promise<void> {
  const stored: PeerFile = {
    version: PEER_FILE_VERSION,
    peerId: material.peerId,
    identitySeed: Buffer.from(material.identity.seed).toString("hex"),
    exchangeSecret: Buffer.from(material.exchange.secret).toString("hex"),
  };
  const temporary = `${file}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => {});
}

function isPeerFile(value: unknown): value is PeerFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === PEER_FILE_VERSION &&
    typeof candidate.peerId === "string" &&
    /^peer_[0-9a-f]{64}$/.test(candidate.peerId) &&
    typeof candidate.identitySeed === "string" &&
    /^[0-9a-f]{64}$/.test(candidate.identitySeed) &&
    typeof candidate.exchangeSecret === "string" &&
    /^[0-9a-f]{64}$/.test(candidate.exchangeSecret)
  );
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
