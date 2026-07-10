import { randomUUID } from "node:crypto";
import type { RegistryStore } from "../../persistence/registry-store.js";
import type { ActorKeypair, PeerKeypair } from "../../crypto/index.js";
import { generatePeerKeypair, peerKeypairFromPrivateKey } from "../../crypto/index.js";
import type { LocalPeer } from "../membership/membership-log.js";

const PEER_PRIV_KEY_META = "peerPrivKey";

/**
 * This dataRoot's peer identity: the stable Loro peer id (the version-vector site id set on every
 * LoroDoc) + the peer X25519 keypair (the transit-wrap target / per-peer revocation unit, design
 * §13). Random, NOT mnemonic-derived — a lost mnemonic must not let a revoked peer re-derive its
 * key. Always constructed from a RegistryStore (SQLite for persistent, in-memory for ephemeral) so
 * the peer id + key are get-or-created uniformly — the difference is which registry is injected.
 *
 * Owns the ONLY numeric peerId → string policy: `routingId()` is the string label every consumer
 * (sync self-filter, LocalPeer.peerId, the session origin) reads, so the conversion lives in one
 * place rather than scattered `String(peerId)` calls.
 */
export class PeerIdentity {
  private constructor(
    readonly peerId: number | undefined,
    readonly peerKeypair: PeerKeypair | undefined,
  ) {}

  static async persistent(registry: RegistryStore): Promise<PeerIdentity> {
    return new PeerIdentity(await registry.ensurePeerId(), await ensurePeerKey(registry));
  }

  /** The string form of the peer id — the routing/self-filter label + the LocalPeer's peerId.
   *  undefined if this runtime has no peer identity (only in odd non-persistent configs). */
  routingId(): string | undefined {
    return this.peerId === undefined ? undefined : String(this.peerId);
  }

  /** The session-origin node label for changes emitted from this runtime — the stable peer routing
   *  id (so a restart keeps the same origin, matching the Loro site id), or a fresh random id if this
   *  runtime has no peer identity. */
  originLabel(): string {
    return this.routingId() ?? randomUUID();
  }

  /** The LocalPeer (session actor + this dataRoot's peer key + peerId) a host uses for wire security
   *  + membership ops. Throws if this runtime has no peer identity (only in odd non-persistent
   *  configs). */
  localPeerFor(actor: ActorKeypair): LocalPeer {
    if (this.peerId === undefined || this.peerKeypair === undefined) {
      throw new Error("no peer identity on this dataRoot");
    }
    return { actor, peer: this.peerKeypair, peerId: this.routingId()! };
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
