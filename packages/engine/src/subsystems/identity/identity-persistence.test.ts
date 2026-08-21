import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NodePersistenceBackend } from "../persistence/node-persistence-backend.js";
import { Identity } from "./identity.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("identity persistence", () => {
  it("fails closed when an existing Actor Vault is corrupt", async () => {
    const dataRoot = await temporaryRoot();
    const identity = await openIdentity(dataRoot);
    const actor = await identity.createActor({ label: "Owner", passphrase: "identity-test-passphrase" });
    const vaultFile = join(dataRoot, "identity", "vault.json");
    expect(await readFile(vaultFile, "utf8")).toContain(actor.actorId);

    await writeFile(vaultFile, "{broken", "utf8");

    await expect(openIdentity(dataRoot)).rejects.toThrow("Cannot load Actor Vault");
    expect(await readFile(vaultFile, "utf8")).toBe("{broken");
  });

  it("fails closed instead of replacing an existing corrupt Peer identity", async () => {
    const dataRoot = await temporaryRoot();
    const first = await openIdentity(dataRoot);
    const originalPeerId = first.material().peerId;
    const peerFile = join(dataRoot, "identity", "peer.json");
    await writeFile(peerFile, JSON.stringify({ version: 1, peerId: originalPeerId }), "utf8");

    await expect(openIdentity(dataRoot)).rejects.toThrow("Cannot load Peer identity");
    expect(JSON.parse(await readFile(peerFile, "utf8"))).toEqual({ version: 1, peerId: originalPeerId });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lode-identity-persistence-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "identity"), { recursive: true });
  return root;
}

async function openIdentity(dataRoot: string): Promise<Identity> {
  const storage = await new NodePersistenceBackend(dataRoot).openIdentityStorage();
  return Identity.open(storage);
}
