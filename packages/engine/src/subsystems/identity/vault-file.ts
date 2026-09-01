import {
  aeadOpen,
  aeadSeal,
  AeadAuthenticationError,
  isActorId,
  DEFAULT_VAULT_KDF_PARAMETERS,
  deriveVaultKey,
  generateVaultSalt,
  VAULT_CANARY,
  type VaultKdfParameters,
} from "../../crypto/index.js";
import type { BlobStore } from "../persistence/index.js";

/**
 * The Actor Vault: one passphrase-encrypted store per Home holding every
 * Actor's Ed25519 seed. The scrypt salt and parameters travel with the file;
 * the canary authenticates the passphrase even when no entry exists yet.
 */

const VAULT_VERSION = 1;

type VaultEntry = Readonly<{
  actorId: string;
  label: string;
  createdAt: string;
  seed: string;
}>;

type VaultFile = Readonly<{
  version: number;
  kdf: Readonly<{ algo: "scrypt"; salt: string; params: VaultKdfParameters }>;
  canary: string;
  entries: readonly VaultEntry[];
}>;

class VaultLockedError extends Error {
  constructor() {
    super("The Actor Vault is locked; unlock it before identity operations");
    this.name = "VaultLockedError";
  }
}

export class VaultPassphraseError extends Error {
  constructor() {
    super("The Actor Vault passphrase is incorrect");
    this.name = "VaultPassphraseError";
  }
}

export class VaultStore {
  private constructor(
    private readonly store: BlobStore,
    private vault: VaultFile | undefined,
  ) {}

  static async open(storage: BlobStore): Promise<VaultStore> {
    const vault = new VaultStore(storage, undefined);
    await vault.load();
    return vault;
  }

  exists(): boolean {
    return this.vault !== undefined;
  }

  entries(): readonly VaultEntry[] {
    return this.vault?.entries ?? [];
  }

  /** Creates the vault under a fresh passphrase; refuses to re-initialize. */
  async initialize(passphrase: string): Promise<void> {
    if (this.vault) {
      throw new Error("The Actor Vault already exists");
    }
    const salt = generateVaultSalt();
    const key = await deriveVaultKey(passphrase, salt, DEFAULT_VAULT_KDF_PARAMETERS);
    const vault: VaultFile = {
      version: VAULT_VERSION,
      kdf: { algo: "scrypt", salt: toBase64(salt), params: DEFAULT_VAULT_KDF_PARAMETERS },
      canary: toBase64(aeadSeal(key, new TextEncoder().encode(VAULT_CANARY))),
      entries: [],
    };
    await this.persist(vault);
    this.vault = vault;
  }

  /** Verifies the passphrase and returns the key that unlocks every entry. */
  async deriveKey(passphrase: string): Promise<Uint8Array> {
    if (!this.vault) {
      throw new VaultLockedError();
    }
    const key = await deriveVaultKey(passphrase, fromBase64(this.vault.kdf.salt), this.vault.kdf.params);
    let opened: string;
    try {
      opened = new TextDecoder().decode(aeadOpen(key, fromBase64(this.vault.canary)));
    } catch (error) {
      if (error instanceof AeadAuthenticationError) {
        throw new VaultPassphraseError();
      }
      throw error;
    }
    if (opened !== VAULT_CANARY) {
      throw new VaultPassphraseError();
    }
    return key;
  }

  async appendEntry(key: Uint8Array, entry: Omit<VaultEntry, "seed">, seed: Uint8Array): Promise<void> {
    if (!this.vault) {
      throw new VaultLockedError();
    }
    if (this.vault.entries.some((existing) => existing.actorId === entry.actorId)) {
      throw new Error(`Actor ${entry.actorId} already exists in this Home`);
    }
    const vault: VaultFile = {
      ...this.vault,
      entries: [...this.vault.entries, { ...entry, seed: toBase64(aeadSeal(key, seed)) }],
    };
    await this.persist(vault);
    this.vault = vault;
  }

  openEntrySeed(key: Uint8Array, entry: VaultEntry): Uint8Array {
    return aeadOpen(key, fromBase64(entry.seed));
  }

  private async load(): Promise<void> {
    const bytes = await this.store.read();
    if (bytes === null) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!isVaultFile(parsed)) {
        throw new Error("Actor Vault is corrupt");
      }
      this.vault = parsed;
    } catch (error) {
      throw new Error("Cannot load Actor Vault", { cause: error });
    }
  }

  private async persist(vault: VaultFile): Promise<void> {
    await this.store.write(new TextEncoder().encode(`${JSON.stringify(vault, null, 2)}\n`));
  }
}

function isVaultFile(value: unknown): value is VaultFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== VAULT_VERSION ||
    !isVaultKdf(candidate.kdf) ||
    !isSealedBase64(candidate.canary) ||
    !Array.isArray(candidate.entries) ||
    !candidate.entries.every(isVaultEntry)
  ) {
    return false;
  }
  const actorIds = candidate.entries.map((entry) => entry.actorId);
  return new Set(actorIds).size === actorIds.length;
}

function isVaultKdf(value: unknown): value is VaultFile["kdf"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const parameters = candidate.params;
  return (
    candidate.algo === "scrypt" &&
    isBase64Bytes(candidate.salt, 16) &&
    typeof parameters === "object" &&
    parameters !== null &&
    isKdfParameters(parameters as Record<string, unknown>)
  );
}

function isKdfParameters(value: Record<string, unknown>): value is Record<"n" | "r" | "p", number> {
  const n = value.n;
  const r = value.r;
  const p = value.p;
  return (
    Number.isSafeInteger(n) &&
    typeof n === "number" &&
    n >= 2 ** 14 &&
    n <= 2 ** 20 &&
    (n & (n - 1)) === 0 &&
    Number.isSafeInteger(r) &&
    typeof r === "number" &&
    r >= 1 &&
    r <= 32 &&
    Number.isSafeInteger(p) &&
    typeof p === "number" &&
    p >= 1 &&
    p <= 16
  );
}

function isVaultEntry(value: unknown): value is VaultEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.actorId === "string" &&
    isActorId(candidate.actorId) &&
    typeof candidate.label === "string" &&
    typeof candidate.createdAt === "string" &&
    !Number.isNaN(Date.parse(candidate.createdAt)) &&
    isSealedBase64(candidate.seed)
  );
}

function isSealedBase64(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length >= 28;
}

function isBase64Bytes(value: unknown, length: number): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === length
  );
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}
