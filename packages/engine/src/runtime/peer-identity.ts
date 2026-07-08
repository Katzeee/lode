import type { RegistryStore } from "../persistence/registry-store.js";
import type { ActorKeypair, PeerKeypair } from "../utils/crypto/index.js";
import { generatePeerKeypair, peerKeypairFromPrivateKey } from "../utils/crypto/index.js";
import type { LocalPeer } from "./membership/membership-log.js";

const PEER_PRIV_KEY_META = "peerPrivKey";

/**
 * This dataRoot's peer identity: the stable Loro peer id (the version-vector site id set on every
 * LoroDoc) + the peer X25519 keypair (the transit-wrap target / per-peer revocation unit, design
 * §13). Random, NOT mnemonic-derived — a lost mnemonic must not let a revoked peer re-derive its
 * key. Always constructed from a RegistryStore (SQLite for persistent, in-memory for ephemeral) so
 * the peer id + key are get-or-created uniformly — the difference is which registry is injected.
 */
export class PeerIdentity {
  private constructor(
    readonly peerId: number | undefined,
    readonly peerKeypair: PeerKeypair | undefined,
  ) {}

  static async persistent(registry: RegistryStore): Promise<PeerIdentity> {
    return new PeerIdentity(await registry.ensurePeerId(), await ensurePeerKey(registry));
  }

  /** The LocalPeer (session actor + this dataRoot's peer key + peerId) a host uses for wire security
   *  + membership ops. Throws if this runtime has no peer identity (only in odd non-persistent
   *  configs). */
  localPeerFor(actor: ActorKeypair): LocalPeer {
    if (this.peerId === undefined || this.peerKeypair === undefined) {
      throw new Error("no peer identity on this dataRoot");
    }
    return { actor, peer: this.peerKeypair, peerId: String(this.peerId) };
  }
}

/** Get-or-create this dataRoot's peer X25519 keypair. The private scalar is persisted in
 *  registry_meta (opaque bytes — the registry leaf stores it without knowing it is a key); the
 *  public is deterministic from the private. */
async function ensurePeerKey(registry: RegistryStore): Promise<PeerKeypair> {
  const stored = await registry.getMeta(PEER_PRIV_KEY_META);
  if (stored !== null) {
    try {
      return peerKeypairFromPrivateKey(new Uint8Array(Buffer.from(stored, "hex")));
    } catch {
      // A corrupt/stale value — fall through and re-generate.
    }
  }
  const kp = generatePeerKeypair();
  await registry.setMeta(PEER_PRIV_KEY_META, Buffer.from(kp.privateKey).toString("hex"));
  return kp;
}
