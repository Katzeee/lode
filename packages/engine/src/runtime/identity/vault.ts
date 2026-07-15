/* eslint-disable max-lines -- VaultRuntime is one cohesive state machine (LOCKED/UNLOCKED/GRACE + lease TTL + PIN + identity management). Persistence, serialization, and the TTL (de)serialization are already split into vault-file.ts; further splitting would scatter this single concept across friend classes exposing private state. */
import { randomBytes } from "node:crypto";
import {
  aeadDecrypt,
  aeadEncrypt,
  deriveActorKeypairFromMnemonic,
  deriveVaultKey,
  DEFAULT_KDF_PARAMS,
  generateMnemonic,
  validateMnemonic,
  type ActorKeypair,
  type KdfParams,
} from "../../crypto/index.js";
import {
  AuthenticationError,
  PreconditionFailedError,
  VaultLockedError,
} from "../../errors/index.js";
import {
  atomicWrite,
  DEFAULT_TTL,
  fromB64,
  readVaultFile,
  requireStrength,
  toB64,
  VAULT_CANARY,
  VAULT_VERSION,
  type VaultEntry,
  type VaultFile,
  type VaultTtl,
} from "./vault-file.js";
/** Minimum passphrase length — the offline-brake floor (no keychain ⇒ strength = password + slow KDF). */
const MIN_PASSPHRASE_LEN = 12;
/** Minimum PIN length. The PIN only re-confirms identity during a GRACE re-lock (keys in memory); it
 *  never decrypts the vault, so a short code suffices. */
const MIN_PIN_LEN = 4;
/** Wrong-PIN attempts before PIN is disabled (must re-authenticate with the passphrase). In-memory. */
const MAX_PIN_ATTEMPTS = 5;
/** Lighter KDF for the PIN verifier (the 5-attempt cap bounds brute force; PIN never decrypts data). */
const DEFAULT_PIN_KDF_PARAMS: KdfParams = { n: 16_384, r: 8, p: 1 };

export type VaultState = "LOCKED" | "UNLOCKED" | "GRACE";

export type IdentityInfo = { actorId: string; label: string; createdAt: number };
export type VaultStatusInfo = {
  state: VaultState;
  identities: IdentityInfo[];
  hasPin: boolean;
  activeUntil: number;
  pinFailedCount: number;
};

// vault.json shape + canary live in vault-file.ts; this file owns the in-memory state machine.

/**
 * The daemon-singleton encrypted identity store. LOCKED↔UNLOCKED, plus GRACE: when the unlock lease
 * expires but sync is registered (needs the keys in memory to keep signing rounds), the keys stay
 * loaded and the state moves to GRACE — interactive access is gated (PIN/passphrase re-confirm) while
 * background sync keeps running. At rest (vault.json): scrypt salt+params+canary, an optional PIN
 * verifier, and a per-identity AEAD blob of the mnemonic. Pure engine (crypto + errors); the host owns
 * the path (LODE_HOME/identity/vault.json), the TTL (config.json), and the RPC mapping.
 */
export class VaultRuntime {
  private state: VaultState = "LOCKED";
  private readonly path?: string;
  private file: VaultFile | null = null;
  private derivedKey: Uint8Array | null = null;
  private readonly keypairs = new Map<string, ActorKeypair>();
  private readonly initKdfParams: KdfParams;
  private readonly pinKdfParams: KdfParams;
  private readonly ttl: VaultTtl;
  private activeUntil = 0;
  private singleUse = false; // always-TTL: one access after unlock, then re-confirm
  private pinFailCount = 0;
  // Late-bound "is sync registered?" — injected by the sync component so the lease-expiry transition
  // can pick GRACE (keep keys) vs LOCKED (drop keys) without identity depending on sync.
  private syncDetector?: () => boolean;
  // Serializes mutating writes so concurrent identity creations / setPin can't interleave + lose data.
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    path?: string,
    kdfParams?: KdfParams,
    pinKdfParams?: KdfParams,
    ttl?: VaultTtl,
  ) {
    this.path = path;
    this.initKdfParams = kdfParams ?? DEFAULT_KDF_PARAMS;
    this.pinKdfParams = pinKdfParams ?? DEFAULT_PIN_KDF_PARAMS;
    this.ttl = ttl ?? DEFAULT_TTL;
  }

  /** Load an existing vault.json (or start fresh). Tests inject light KDF params for speed. */
  static async load(
    path?: string,
    options?: { kdfParams?: KdfParams; pinKdfParams?: KdfParams; ttl?: VaultTtl },
  ): Promise<VaultRuntime> {
    const vault = new VaultRuntime(path, options?.kdfParams, options?.pinKdfParams, options?.ttl);
    if (path !== undefined) {
      vault.file = await readVaultFile(path);
    }
    return vault;
  }

  /** An unavailable vault (no path) — for in-process/test runtimes that auth via `sessionHello`. */
  static disabled(): VaultRuntime {
    return new VaultRuntime(undefined);
  }

  /** Inject the "is sync registered?" detector (sync component calls this after wiring). */
  setActiveSyncsDetector(detector: () => boolean): void {
    this.syncDetector = detector;
  }

  /** A path was supplied (socket deployment). False for in-process/test runtimes (no vault). */
  get available(): boolean {
    return this.path !== undefined;
  }

  /** Interactively usable (UNLOCKED with a valid lease). Applies the lease first, so a just-expired
   *  UNLOCKED reads as GRACE/LOCKED. */
  get isOpen(): boolean {
    this.checkLease();
    return this.state === "UNLOCKED";
  }

  status(): VaultStatusInfo {
    this.checkLease();
    return {
      state: this.state,
      identities: this.file === null ? [] : this.file.entries.map(toIdentityInfo),
      hasPin: this.file?.pin !== undefined,
      activeUntil: this.ttl.kind === "session" || this.state !== "UNLOCKED" ? 0 : this.activeUntil,
      pinFailedCount: this.pinFailCount,
    };
  }

  /** The loaded keypair for an actor (no lease check); undefined if the keys aren't in memory. */
  keypairFor(actorId: string): ActorKeypair | undefined {
    return this.keypairs.get(actorId);
  }

  async init(passphrase: string): Promise<VaultStatusInfo> {
    this.requireAvailable();
    if (this.file !== null) {
      throw new PreconditionFailedError("vault already initialized");
    }
    requireStrength(passphrase, MIN_PASSPHRASE_LEN);
    const salt = randomBytes(16);
    const key = await deriveVaultKey(passphrase, salt, this.initKdfParams);
    // Build + persist BEFORE committing in-memory state, so a failed write leaves this instance
    // LOCKED + empty (a retry/init-from-disk recovers) rather than half-initialized.
    const file: VaultFile = {
      version: VAULT_VERSION,
      kdf: {
        algo: "scrypt",
        salt: toB64(salt),
        params: this.initKdfParams,
        verifier: toB64(aeadEncrypt(key, Buffer.from(VAULT_CANARY, "utf8"))),
      },
      entries: [],
    };
    await atomicWrite(this.path as string, `${JSON.stringify(file, null, 2)}\n`);
    this.derivedKey = key;
    this.file = file;
    this.keypairs.clear();
    this.open();
    return this.status();
  }

  async unlock(passphrase: string): Promise<VaultStatusInfo> {
    this.requireAvailable();
    if (this.file === null) {
      throw new PreconditionFailedError("vault not initialized");
    }
    const key = await deriveVaultKey(passphrase, fromB64(this.file.kdf.salt), this.file.kdf.params);
    // Open the canary FIRST: a wrong passphrase fails here (authenticated), before any entry is
    // touched — and crucially before an empty vault would otherwise accept any passphrase.
    this.openAead(key, this.file.kdf.verifier, true);
    const loaded = new Map<string, ActorKeypair>();
    for (const entry of this.file.entries) {
      loaded.set(
        entry.actorId,
        deriveActorKeypairFromMnemonic(this.openAead(key, entry.ct, false)),
      );
    }
    this.derivedKey = key;
    this.keypairs.clear();
    for (const [actorId, keypair] of loaded) {
      this.keypairs.set(actorId, keypair);
    }
    this.open();
    return this.status();
  }

  lock(): VaultStatusInfo {
    this.derivedKey = null;
    this.keypairs.clear();
    this.state = "LOCKED";
    this.activeUntil = 0;
    this.singleUse = false;
    this.pinFailCount = 0;
    return this.status();
  }

  async createIdentity(label: string): Promise<{ actorId: string; mnemonic: string }> {
    this.requireUnlocked();
    const mnemonic = generateMnemonic();
    const keypair = deriveActorKeypairFromMnemonic(mnemonic);
    await this.queueWrite(async () => {
      const ct = toB64(aeadEncrypt(this.derivedKey as Uint8Array, Buffer.from(mnemonic, "utf8")));
      this.keypairs.set(keypair.actorId, keypair);
      this.file?.entries.push({ actorId: keypair.actorId, label, createdAt: Date.now(), ct });
      await this.persist();
    });
    return { actorId: keypair.actorId, mnemonic };
  }

  async importIdentity(mnemonic: string, label: string): Promise<{ actorId: string }> {
    this.requireUnlocked();
    if (!validateMnemonic(mnemonic)) {
      throw new AuthenticationError("importIdentity: invalid mnemonic");
    }
    const keypair = deriveActorKeypairFromMnemonic(mnemonic);
    await this.queueWrite(async () => {
      const ct = toB64(aeadEncrypt(this.derivedKey as Uint8Array, Buffer.from(mnemonic, "utf8")));
      this.keypairs.set(keypair.actorId, keypair);
      this.file?.entries.push({ actorId: keypair.actorId, label, createdAt: Date.now(), ct });
      await this.persist();
    });
    return { actorId: keypair.actorId };
  }

  /** Set/change the PIN (requires UNLOCKED — the caller has already proven the passphrase). The PIN
   *  only re-confirms identity during a GRACE re-lock; it never decrypts the vault. */
  async setPin(pin: string): Promise<VaultStatusInfo> {
    this.requireUnlocked();
    requireStrength(pin, MIN_PIN_LEN);
    const salt = randomBytes(16);
    const verifier = toB64(await deriveVaultKey(pin, salt, this.pinKdfParams));
    await this.queueWrite(async () => {
      if (this.file === null) {
        return;
      }
      this.file.pin = { verifier, salt: toB64(salt) };
      await this.persist();
    });
    return this.status();
  }

  /** Re-unlock from GRACE with the PIN (keys still in memory). 5 wrong attempts disable PIN until the
   *  passphrase is supplied via `unlock`. Only valid from GRACE (cold LOCKED needs the passphrase). */
  async unlockWithPin(pin: string): Promise<VaultStatusInfo> {
    this.requireAvailable();
    this.checkLease(); // let an expired lease drop UNLOCKED → GRACE before the state check
    if (this.file?.pin === undefined) {
      throw new PreconditionFailedError("no PIN set");
    }
    if (this.state !== "GRACE") {
      throw new PreconditionFailedError(
        "PIN unlock is only available after the lease expires (GRACE)",
      );
    }
    if (this.pinFailCount >= MAX_PIN_ATTEMPTS) {
      throw new PreconditionFailedError(
        "PIN disabled after too many wrong attempts; unlock with passphrase",
      );
    }
    const candidate = await deriveVaultKey(pin, fromB64(this.file.pin.salt), this.pinKdfParams);
    if (toB64(candidate) !== this.file.pin.verifier) {
      this.pinFailCount += 1;
      if (this.pinFailCount >= MAX_PIN_ATTEMPTS) {
        throw new PreconditionFailedError(
          "PIN disabled after too many wrong attempts; unlock with passphrase",
        );
      }
      throw new AuthenticationError("wrong PIN");
    }
    this.pinFailCount = 0;
    // Keys are still in memory (GRACE kept them); just return to UNLOCKED with a fresh lease.
    this.open();
    return this.status();
  }

  /** Resolve the keypair for an authed command. Applies the lease (may drop to LOCKED/GRACE), throws
   *  VaultLockedError when not interactively usable, and refreshes a sliding lease on success. */
  access(actorId: string): ActorKeypair {
    this.checkLease();
    if (this.state === "LOCKED") {
      throw new VaultLockedError("cold");
    }
    if (this.state === "GRACE") {
      throw new VaultLockedError("lease-expired");
    }
    // Resolve the keypair BEFORE consuming the lease, so a wrong actorId doesn't burn the single-use
    // always-lease on a misconfigured caller.
    const keypair = this.keypairs.get(actorId);
    if (keypair === undefined) {
      throw new PreconditionFailedError(`actor ${actorId} is not in the vault`);
    }
    // UNLOCKED — consume a single-use lease, or refresh a sliding one (only on success).
    if (this.ttl.kind === "always") {
      this.singleUse = false;
    } else if (this.ttl.kind === "duration" && this.ttl.sliding) {
      this.activeUntil = Date.now() + this.ttl.ms;
    }
    return keypair;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Transition to UNLOCKED and arm the lease per the TTL policy. */
  private open(): void {
    this.state = "UNLOCKED";
    this.pinFailCount = 0;
    if (this.ttl.kind === "always") {
      this.singleUse = true;
      this.activeUntil = 0;
    } else if (this.ttl.kind === "duration") {
      this.singleUse = false;
      this.activeUntil = Date.now() + this.ttl.ms;
    } else {
      this.singleUse = false;
      this.activeUntil = Number.POSITIVE_INFINITY;
    }
  }

  /** Lazily expire an UNLOCKED lease (→ GRACE iff sync is registered, else LOCKED), and self-heal out
   *  of GRACE once sync is no longer registered (so keys don't outlive the thing that needed them). */
  private checkLease(): void {
    if (this.state === "UNLOCKED") {
      const expired =
        this.ttl.kind === "always"
          ? !this.singleUse
          : this.ttl.kind === "duration"
            ? Date.now() >= this.activeUntil
            : false; // session: never expires
      if (expired) {
        if (this.syncDetector?.() ?? false) {
          this.state = "GRACE";
        } else {
          this.dropKeys();
        }
      }
    } else if (this.state === "GRACE" && !(this.syncDetector?.() ?? false)) {
      // Sync unregistered while in GRACE — nothing needs the keys anymore; drop them.
      this.dropKeys();
    }
  }

  private dropKeys(): void {
    this.derivedKey = null;
    this.keypairs.clear();
    this.state = "LOCKED";
  }

  private requireAvailable(): void {
    if (!this.available) {
      throw new PreconditionFailedError("vault not available in this deployment");
    }
  }

  private requireUnlocked(): void {
    this.requireAvailable();
    this.checkLease();
    if (this.state !== "UNLOCKED" || this.derivedKey === null) {
      throw new PreconditionFailedError("vault is locked; unlock it first");
    }
  }

  private async queueWrite(fn: () => Promise<void>): Promise<void> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
  }

  /** AEAD-open a blob under `key`; throw AuthenticationError on a wrong key. `expectCanary` additionally
   *  requires the plaintext to be the vault canary (proves the passphrase on unlock). */
  private openAead(key: Uint8Array, blob: string, expectCanary: boolean): string {
    try {
      const plain = Buffer.from(aeadDecrypt(key, fromB64(blob))).toString("utf8");
      if (expectCanary && plain !== VAULT_CANARY) {
        throw new Error("canary mismatch");
      }
      return plain;
    } catch {
      throw new AuthenticationError("unlock failed (wrong passphrase or corrupted vault)");
    }
  }

  private async persist(): Promise<void> {
    if (this.path === undefined || this.file === null) {
      return;
    }
    await atomicWrite(this.path, `${JSON.stringify(this.file, null, 2)}\n`);
  }
}

function toIdentityInfo(entry: VaultEntry): IdentityInfo {
  return { actorId: entry.actorId, label: entry.label, createdAt: entry.createdAt };
}
