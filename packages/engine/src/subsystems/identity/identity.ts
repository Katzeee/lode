import {
  actorIdFromPublicKey,
  ed25519PublicFromSeed,
  generateRecoveryPhrase,
  keyPairFromPhrase,
  MIN_PASSPHRASE_LENGTH,
  normalizePhrase,
  signBytes,
  type SigningKeyPair,
} from "../../crypto/index.js";
import { loadOrCreatePeerMaterial, type PeerMaterial } from "./peer-identity.js";
import { VaultPassphraseError, VaultStore } from "./vault-file.js";
import type { IdentityStorage } from "../persistence/index.js";
import type { ActorSummary } from "./capability.js";

/**
 * Engine identity: the Actor Vault plus the Peer identity. The vault holds
 * every Actor this Engine can act as; unlocking loads Ed25519 seeds
 * into memory and makes Fact attribution signatures available to workspace
 * commits. The Peer identity is always available — replica exchange and Fact
 * forwarding never depend on an unlocked vault.
 */

export class ActorLockedError extends Error {
  constructor(actorId: string) {
    super(`Actor ${actorId} has no unlocked key in this Home`);
    this.name = "ActorLockedError";
  }
}

export class Identity {
  private unlockedKeys = new Map<string, SigningKeyPair>();
  private readonly vault: VaultStore;

  private constructor(
    vaultStore: VaultStore,
    private readonly peerMaterial: PeerMaterial,
  ) {
    this.vault = vaultStore;
  }

  static async open(storage: Pick<IdentityStorage, "vault" | "peerIdentity">): Promise<Identity> {
    const vault = await VaultStore.open(storage.vault);
    const peer = await loadOrCreatePeerMaterial(storage.peerIdentity);
    return new Identity(vault, peer);
  }

  material(): PeerMaterial {
    return this.peerMaterial;
  }

  vaultExists(): boolean {
    return this.vault.exists();
  }

  listActors(): readonly ActorSummary[] {
    return this.vault.entries().map((entry) => ({
      actorId: entry.actorId,
      label: entry.label,
      createdAt: entry.createdAt,
      unlocked: this.unlockedKeys.has(entry.actorId),
    }));
  }

  /** Creates a fresh Actor and returns its recovery phrase exactly once. */
  async createActor(
    input: Readonly<{ label: string; passphrase: string }>,
  ): Promise<Readonly<{ actorId: string; phrase: string }>> {
    const key = await this.sessionKey(input.passphrase);
    const { phrase, keyPair } = generateRecoveryPhrase();
    const actorId = actorIdFromPublicKey(keyPair.publicKey);
    await this.vault.appendEntry(
      key,
      { actorId, label: input.label, createdAt: new Date().toISOString() },
      keyPair.seed,
    );
    this.unlockedKeys.set(actorId, keyPair);
    return { actorId, phrase };
  }

  /** Restores an Actor from its recovery phrase; importing twice is idempotent. */
  async importActor(
    input: Readonly<{ phrase: string; passphrase: string; label: string }>,
  ): Promise<Readonly<{ actorId: string }>> {
    const key = await this.sessionKey(input.passphrase);
    const keyPair = keyPairFromPhrase(normalizePhrase(input.phrase));
    const actorId = actorIdFromPublicKey(keyPair.publicKey);
    if (!this.vault.entries().some((entry) => entry.actorId === actorId)) {
      await this.vault.appendEntry(
        key,
        { actorId, label: input.label, createdAt: new Date().toISOString() },
        keyPair.seed,
      );
    }
    this.unlockedKeys.set(actorId, keyPair);
    return { actorId };
  }

  async unlock(passphrase: string): Promise<readonly ActorSummary[]> {
    await this.sessionKey(passphrase);
    return this.listActors();
  }

  lock(): void {
    this.unlockedKeys = new Map();
  }

  isActorUnlocked(actorId: string): boolean {
    return this.unlockedKeys.has(actorId);
  }

  /** Fact attribution signature; throws when the Actor has no unlocked key. */
  signFact(digest: string, actorId: string): string {
    const keyPair = this.unlockedKeys.get(actorId);
    if (!keyPair) {
      throw new ActorLockedError(actorId);
    }
    return Buffer.from(signBytes(Buffer.from(digest, "utf8"), keyPair.seed)).toString("base64");
  }

  /**
   * The vault key for a passphrase, initializing a first-time vault and
   * loading every Actor's key when this process has none yet. Wrong
   * passphrases fail the vault canary.
   */
  private async sessionKey(passphrase: string): Promise<Uint8Array> {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`Vault passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
    }
    if (!this.vault.exists()) {
      await this.vault.initialize(passphrase);
    }
    const key = await this.vault.deriveKey(passphrase);
    if (this.unlockedKeys.size === 0) {
      this.unlockedKeys = new Map();
      for (const entry of this.vault.entries()) {
        const seed = this.vault.openEntrySeed(key, entry);
        const publicKey = ed25519PublicFromSeed(seed);
        if (actorIdFromPublicKey(publicKey) !== entry.actorId) {
          this.unlockedKeys = new Map();
          throw new VaultPassphraseError();
        }
        this.unlockedKeys.set(entry.actorId, { seed, publicKey });
      }
    }
    return key;
  }
}
