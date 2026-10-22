import {
  bytesToHex,
  ed25519PublicFromSeed,
  generateExchangeKeyPair,
  generateSigningKeyPair,
  hexToBytes,
  peerIdFromPublicKey,
  x25519PublicFromSecret,
  type ExchangeKeyPair,
  type SigningKeyPair,
} from "../../crypto/index.js";
import type { BlobStore } from "../persistence/index.js";

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

export async function loadOrCreatePeerMaterial(store: BlobStore): Promise<PeerMaterial> {
  const bytes = await store.read();
  if (bytes !== null) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!isPeerFile(parsed)) {
        throw new Error("Peer identity is corrupt");
      }
      return materialFromFile(parsed);
    } catch (error) {
      throw new Error("Cannot load Peer identity", { cause: error });
    }
  }
  const material = createPeerMaterial();
  await persistPeerMaterial(store, material);
  return material;
}

function createPeerMaterial(): PeerMaterial {
  const identity = generateSigningKeyPair();
  const exchange = generateExchangeKeyPair();
  return { peerId: peerIdFromPublicKey(identity.publicKey), identity, exchange };
}

// ponytail: recompute publics from seeds rather than storing them, so the file
// can never disagree with its own secrets.
function materialFromFile(file: PeerFile): PeerMaterial {
  const identitySeed = hexToBytes(file.identitySeed);
  const exchangeSecret = hexToBytes(file.exchangeSecret);
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

async function persistPeerMaterial(store: BlobStore, material: PeerMaterial): Promise<void> {
  const stored: PeerFile = {
    version: PEER_FILE_VERSION,
    peerId: material.peerId,
    identitySeed: bytesToHex(material.identity.seed),
    exchangeSecret: bytesToHex(material.exchange.secret),
  };
  await store.write(new TextEncoder().encode(`${JSON.stringify(stored, null, 2)}\n`));
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
