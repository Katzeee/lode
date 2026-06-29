import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actorKeystorePath } from "../persistence/paths.js";
import { generateMnemonic } from "../utils/crypto/bip39.js";
import { verifyActorSignature, signWithActor } from "./actor-key.js";
import { ActorStore } from "./actor-store.js";

let tempDir: string;
let store: ActorStore;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "lode-actors-"));
  store = await ActorStore.open(tempDir);
});

afterEach(async () => {
  await store.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("ActorStore", () => {
  it("creates an actor, catalogs it, and writes a 0600 keystore", async () => {
    const { record, keypair } = await store.createActor({ displayName: "Personal" });
    expect(record.actorId).toBe(keypair.actorId);
    expect(record.displayName).toBe("Personal");
    expect(record.publicKey).toHaveLength(32);

    await expect(store.getActor(record.actorId)).resolves.toMatchObject({
      actorId: record.actorId,
      displayName: "Personal",
    });
    await expect(store.listActors()).resolves.toEqual([record]);

    // Keystore file exists with restrictive mode (0600 → 0o100600).
    const st = await stat(actorKeystorePath(tempDir, record.actorId));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("loads a private key that signs against the cataloged public key", async () => {
    const { record } = await store.createActor({ displayName: "Work" });
    const privateKey = await store.loadPrivateKey(record.actorId);
    const data = new TextEncoder().encode("challenge");
    const sig = signWithActor(privateKey, data);
    expect(verifyActorSignature(record.publicKey, data, sig)).toBe(true);
  });

  it("persists actors across reopen", async () => {
    const { record } = await store.createActor({ displayName: "Persistent" });
    await store.close();
    store = await ActorStore.open(tempDir);
    await expect(store.listActors()).resolves.toEqual([record]);
    // Private key survived too: it signs against the cataloged public key.
    const privateKey = await store.loadPrivateKey(record.actorId);
    const probe = new TextEncoder().encode("probe");
    expect(verifyActorSignature(record.publicKey, probe, signWithActor(privateKey, probe))).toBe(
      true,
    );
  });

  it("removes an actor from the catalog and deletes its keystore", async () => {
    const { record } = await store.createActor({ displayName: "Gone" });
    await expect(store.removeActor(record.actorId)).resolves.toBe(true);
    await expect(store.removeActor(record.actorId)).resolves.toBe(false); // already gone
    await expect(store.getActor(record.actorId)).resolves.toBeNull();
    await expect(stat(actorKeystorePath(tempDir, record.actorId))).rejects.toThrow();
  });

  it("recovers the SAME actorId from a mnemonic on a fresh dataRoot (continuity)", async () => {
    const mnemonic = generateMnemonic();
    const { record: original } = await store.createActor({ displayName: "Original", mnemonic });

    // A fresh dataRoot (a new device) recovering from the same mnemonic → same identity.
    const otherDir = await mkdtemp(join(tmpdir(), "lode-actors-"));
    try {
      const recovered = await ActorStore.open(otherDir);
      try {
        const { record } = await recovered.createActor({ displayName: "Recovered", mnemonic });
        expect(record.actorId).toBe(original.actorId);
        // The recovered private key signs against the original public key.
        const priv = await recovered.loadPrivateKey(record.actorId);
        const data = new TextEncoder().encode("continuity");
        expect(verifyActorSignature(original.publicKey, data, signWithActor(priv, data))).toBe(
          true,
        );
      } finally {
        await recovered.close();
      }
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  it("refuses to recover a mnemonic whose actor already exists on this dataRoot", async () => {
    const mnemonic = generateMnemonic();
    await store.createActor({ displayName: "First", mnemonic });
    await expect(store.createActor({ displayName: "Second", mnemonic })).rejects.toThrow();
  });
});
