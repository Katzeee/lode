import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NodePersistenceBackend } from "../persistence/node-persistence-backend.js";
import { buildEngineSubsystems } from "../index.js";
import { createPersistenceSubsystemDefinition } from "../persistence/persistence-subsystem.js";
import { createIdentitySubsystemDefinition } from "./identity-subsystem.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("IdentitySubsystem", () => {
  it("persists its Actor Vault and Peer identity through Persistence", async () => {
    const dataRoot = await temporaryDirectory();
    const first = buildIdentity(dataRoot);
    await first.lifecycle.start();
    const created = await first.api.vault.createActor({ label: "Owner", passphrase: "identity-test-passphrase" });
    const peerId = first.api.peer.peerId();
    expect(first.api.signing.isActorUnlocked(created.actorId)).toBe(true);
    await first.lifecycle.stop();

    expect(() => first.api.peer.peerId()).toThrow("Identity subsystem is not initialized");

    const second = buildIdentity(dataRoot);
    await second.lifecycle.start();
    expect(second.api.peer.peerId()).toBe(peerId);
    expect(second.api.vault.listActors()).toMatchObject([
      { actorId: created.actorId, label: "Owner", unlocked: false },
    ]);
    await second.api.vault.unlock("identity-test-passphrase");
    expect(second.api.signing.isActorUnlocked(created.actorId)).toBe(true);
    await second.lifecycle.stop();
  });

  it("stops Persistence when corrupt identity storage makes initialization roll back", async () => {
    const dataRoot = await temporaryDirectory();
    await mkdir(join(dataRoot, "identity"), { recursive: true });
    await writeFile(join(dataRoot, "identity", "vault.json"), "{broken", "utf8");
    const backend = new NodePersistenceBackend(dataRoot);
    const persistence = createPersistenceSubsystemDefinition(backend);
    const identity = createIdentitySubsystemDefinition(persistence);
    const built = buildEngineSubsystems([identity, persistence] as const, ({ identity: capability }) => capability);

    await expect(built.lifecycle.start()).rejects.toThrow("Cannot load Actor Vault");
    expect(() => built.api.vault.exists()).toThrow("Identity subsystem is not initialized");
    expect(() => backend.openIdentityStorage()).toThrow("Persistence backend is closed");
  });
});

function buildIdentity(dataRoot: string) {
  const persistence = createPersistenceSubsystemDefinition(new NodePersistenceBackend(dataRoot));
  const identity = createIdentitySubsystemDefinition(persistence);
  return buildEngineSubsystems([identity, persistence] as const, ({ identity: capability }) => capability);
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lode-identity-subsystem-"));
  temporaryDirectories.push(directory);
  return directory;
}
