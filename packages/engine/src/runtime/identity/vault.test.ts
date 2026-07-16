import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveActorKeypairFromMnemonic, generateMnemonic } from "../../crypto/index.js";
import { DomainInvalidInputError } from "../../domain/errors.js";
import {
  AuthenticationError,
  PreconditionFailedError,
  VaultLockedError,
} from "../../errors/index.js";
import { VaultRuntime } from "./vault.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Light KDF so the suite is instant — production uses the heavy default; the params are stored
// per-vault, so a vault minted here unlocks here consistently.
const LIGHT = { n: 1024, r: 8, p: 1 };
const PASS = "strong-passphrase-1";

describe("VaultRuntime", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vault-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("init → createIdentity → lock → restart → unlock round-trips the keypair", async () => {
    const path = join(dir, "vault.json");
    const vault = await VaultRuntime.load(path, { kdfParams: LIGHT });
    await vault.init(PASS);
    expect(vault.isOpen).toBe(true);

    const { actorId, mnemonic } = await vault.createIdentity("alice");
    expect(actorId).toBe(deriveActorKeypairFromMnemonic(mnemonic).actorId);
    expect(vault.keypairFor(actorId)).toBeDefined();

    vault.lock();
    expect(vault.isOpen).toBe(false);
    expect(vault.keypairFor(actorId)).toBeUndefined();

    // A new instance reads disk → LOCKED; labels stay visible, mnemonics don't.
    const reloaded = await VaultRuntime.load(path, { kdfParams: LIGHT });
    expect(reloaded.isOpen).toBe(false);
    expect(reloaded.status().identities.map((i) => i.actorId)).toContain(actorId);
    await reloaded.unlock(PASS);
    expect(reloaded.isOpen).toBe(true);
    expect(reloaded.keypairFor(actorId)).toBeDefined();
  });

  it("rejects a wrong passphrase on unlock", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), { kdfParams: LIGHT });
    await vault.init(PASS);
    await vault.createIdentity("a");
    vault.lock();
    await expect(vault.unlock("wrong-passphrase-2")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a weak passphrase on init", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), { kdfParams: LIGHT });
    await expect(vault.init("short")).rejects.toBeInstanceOf(DomainInvalidInputError);
  });

  it("refuses createIdentity while locked (VaultLockedError so the client can lazy-unlock)", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), { kdfParams: LIGHT });
    await vault.init(PASS);
    vault.lock();
    await expect(vault.createIdentity("a")).rejects.toBeInstanceOf(VaultLockedError);
  });

  it("importIdentity derives the actorId from the mnemonic", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), { kdfParams: LIGHT });
    await vault.init(PASS);
    const mnemonic = generateMnemonic();
    const expected = deriveActorKeypairFromMnemonic(mnemonic).actorId;
    const { actorId } = await vault.importIdentity(mnemonic, "imported");
    expect(actorId).toBe(expected);
    expect(vault.keypairFor(actorId)).toBeDefined();
  });

  it("refuses to re-init an existing vault", async () => {
    const path = join(dir, "v.json");
    const vault = await VaultRuntime.load(path, { kdfParams: LIGHT });
    await vault.init(PASS);
    const again = await VaultRuntime.load(path, { kdfParams: LIGHT });
    await expect(again.init(PASS)).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it("disabled() is unavailable and resolves no keypair", () => {
    const vault = VaultRuntime.disabled();
    expect(vault.available).toBe(false);
    expect(vault.keypairFor("x")).toBeUndefined();
  });

  it("rejects a wrong passphrase on an EMPTY vault (the canary, not an entry, must verify)", async () => {
    // An empty vault has no entry whose AEAD-open could fail — without a sealed canary it would accept
    // any passphrase and brick identities later added under the wrong key.
    const path = join(dir, "v.json");
    const vault = await VaultRuntime.load(path, { kdfParams: LIGHT });
    await vault.init(PASS);
    vault.lock();
    const reloaded = await VaultRuntime.load(path, { kdfParams: LIGHT });
    await expect(reloaded.unlock("wrong-passphrase-2")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a corrupt vault.json with a typed error", async () => {
    const path = join(dir, "v.json");
    await writeFile(path, "{ not valid json");
    // A corrupt file is detected at load (it reads + validates the file), not at unlock.
    await expect(VaultRuntime.load(path, { kdfParams: LIGHT })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });

  it("serializes concurrent identity creation (no at-rest entry lost)", async () => {
    const path = join(dir, "v.json");
    const vault = await VaultRuntime.load(path, { kdfParams: LIGHT });
    await vault.init(PASS);
    const { actorId: a } = await vault.createIdentity("a");
    const { actorId: b } = await vault.createIdentity("b");
    // Two creations fired close together; both must survive to disk (reload sees both).
    const [, , created] = await Promise.all([
      vault.createIdentity("c"),
      vault.createIdentity("d"),
      vault.createIdentity("e"),
    ]);
    const reloaded = await VaultRuntime.load(path, { kdfParams: LIGHT });
    await reloaded.unlock(PASS);
    const ids = new Set(reloaded.status().identities.map((i) => i.actorId));
    expect(ids.has(a)).toBe(true);
    expect(ids.has(b)).toBe(true);
    expect(ids.has(created.actorId)).toBe(true);
  });
});

describe("VaultRuntime — lease / GRACE / PIN (Phase 2b)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vault-grace-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lease expiry with no sync → LOCKED (keys dropped, cold)", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), {
      kdfParams: LIGHT,
      ttl: { kind: "duration", ms: 60, sliding: true },
    });
    await vault.init(PASS);
    const { actorId } = await vault.createIdentity("a");
    await sleep(80);
    expect(() => vault.access(actorId)).toThrow(VaultLockedError);
    expect(vault.status().state).toBe("LOCKED");
  });

  it("lease expiry with active sync → GRACE (keys kept, gated as lease-expired)", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), {
      kdfParams: LIGHT,
      ttl: { kind: "duration", ms: 60, sliding: true },
    });
    await vault.init(PASS);
    const { actorId } = await vault.createIdentity("a");
    vault.setActiveSyncsDetector(() => true);
    await sleep(80);
    let caught: unknown;
    try {
      vault.access(actorId);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VaultLockedError);
    expect((caught as VaultLockedError).subtype).toBe("lease-expired");
    expect(vault.status().state).toBe("GRACE");
  });

  it("sliding lease refreshes on each access (no expiry while in use)", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), {
      kdfParams: LIGHT,
      ttl: { kind: "duration", ms: 100, sliding: true },
    });
    await vault.init(PASS);
    const { actorId } = await vault.createIdentity("a");
    await sleep(60);
    vault.access(actorId); // refreshes
    await sleep(60);
    vault.access(actorId); // still valid — refreshed at ~60, expires ~160
    expect(vault.status().state).toBe("UNLOCKED");
  });

  it("setPin + unlockWithPin re-unlocks from GRACE", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), {
      kdfParams: LIGHT,
      pinKdfParams: LIGHT,
      ttl: { kind: "duration", ms: 60, sliding: true },
    });
    await vault.init(PASS);
    await vault.setPin("1234");
    expect(vault.status().hasPin).toBe(true);
    await vault.createIdentity("a");
    vault.setActiveSyncsDetector(() => true);
    await sleep(80);
    expect(vault.status().state).toBe("GRACE");
    await vault.unlockWithPin("1234");
    expect(vault.status().state).toBe("UNLOCKED");
    expect(vault.status().pinFailedCount).toBe(0);
  });

  it("5 wrong PINs disable PIN; the passphrase still unlocks", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), {
      kdfParams: LIGHT,
      pinKdfParams: LIGHT,
      ttl: { kind: "duration", ms: 60, sliding: true },
    });
    await vault.init(PASS);
    await vault.setPin("1234");
    vault.setActiveSyncsDetector(() => true);
    await sleep(80); // → GRACE
    for (let i = 0; i < 4; i += 1) {
      await expect(vault.unlockWithPin("0000")).rejects.toBeInstanceOf(AuthenticationError);
    }
    // 5th wrong attempt disables PIN (PreconditionFailed), as does the now-correct PIN.
    await expect(vault.unlockWithPin("0000")).rejects.toBeInstanceOf(PreconditionFailedError);
    await expect(vault.unlockWithPin("1234")).rejects.toBeInstanceOf(PreconditionFailedError);
    await vault.unlock(PASS); // passphrase is unaffected
    expect(vault.status().state).toBe("UNLOCKED");
  });

  it("PIN is rejected outside GRACE (cold LOCKED needs the passphrase)", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), { kdfParams: LIGHT });
    await vault.init(PASS);
    await vault.setPin("1234");
    vault.lock();
    await expect(vault.unlockWithPin("1234")).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it("always TTL: one access per unlock (status/createIdentity/setPin do not consume it)", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), {
      kdfParams: LIGHT,
      pinKdfParams: LIGHT,
      ttl: { kind: "always" },
    });
    await vault.init(PASS);
    const { actorId } = await vault.createIdentity("a");
    await vault.setPin("1234");
    expect(vault.status().state).toBe("UNLOCKED"); // status doesn't consume
    vault.access(actorId); // consumes the single-use lease
    expect(() => vault.access(actorId)).toThrow(VaultLockedError); // next access is cold
  });

  it("session TTL: never expires", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), {
      kdfParams: LIGHT,
      ttl: { kind: "session" },
    });
    await vault.init(PASS);
    const { actorId } = await vault.createIdentity("a");
    await sleep(80);
    vault.access(actorId); // still unlocked — session never expires
    expect(vault.status().state).toBe("UNLOCKED");
  });

  it("GRACE self-heals to LOCKED once sync unregisters (keys don't outlive sync)", async () => {
    const vault = await VaultRuntime.load(join(dir, "v.json"), {
      kdfParams: LIGHT,
      ttl: { kind: "duration", ms: 60, sliding: true },
    });
    await vault.init(PASS);
    const { actorId } = await vault.createIdentity("a");
    let syncing = true;
    vault.setActiveSyncsDetector(() => syncing);
    await sleep(80);
    expect(vault.status().state).toBe("GRACE");
    syncing = false; // sync unregistered
    expect(() => vault.access(actorId)).toThrow(VaultLockedError);
    expect(vault.status().state).toBe("LOCKED");
  });
});
