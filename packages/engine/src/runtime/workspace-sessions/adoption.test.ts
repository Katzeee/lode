import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEngine } from "../../engine.js";
import { makeFact } from "../../domain/fact/index.js";
import { ProposalWorkspaceRegistry } from "../workspace/proposal-registry.js";
import { SyncExchange } from "../sync/sync-exchange.js";
import { WorkspaceSessions } from "./index.js";
import { validateAdoptionSnapshot } from "./adoption.js";

/**
 * Adoption crash recovery: an interrupted adoption leaves no queryable,
 * editable half-adopted workspace. Whatever the crash window, the next boot
 * either sees nothing or a complete workspace — never staging debris.
 */

const vaultPassphrase = "adoption-recovery-passphrase";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("staged adoption crash recovery", () => {
  it("rejects an established journal that omits the Workspace genesis", () => {
    const owner = `actor_${"0".repeat(64)}`;
    const replicaId = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const establishment = makeFact({
      workspaceId: "workspace",
      replicaId,
      sequence: 1,
      observed: {},
      lamport: 1,
      body: {
        kind: "governance",
        actorId: owner,
        action: { kind: "workspace-establish", ownerActorId: owner },
      },
    });

    expect(() =>
      validateAdoptionSnapshot("workspace", {
        facts: [establishment],
        frontier: { [replicaId]: 1 },
      }),
    ).toThrow("complete Workspace genesis");
  });

  it("an adoption interrupted before promotion leaves no trace after restart", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-adoption-crash-"));
    temporaryDirectories.push(dataRoot);
    const source = await sourceWithGovernedWorkspace("workspace");

    // The joiner stages a full pull and then "crashes" before promotion.
    const registry = new ProposalWorkspaceRegistry();
    const sessions = new WorkspaceSessions(registry, dataRoot);
    const staging = await sessions.stage("workspace");
    const opened = await staging.open();
    const exchanged = await new SyncExchange(opened.sync, source.replicas.peer("workspace")).sync();
    expect(exchanged.pulled).toBeGreaterThan(0);
    expect(opened.facts.admission().kind).toBe("ready");
    await staging.abandon();
    await sessions.release();
    await source.close();

    // The interrupted attempt is invisible: no catalog entry, no queryable
    // workspace, and boot recovery removed the staging store and manifest.
    const restarted = await createEngine({ persistence: { dataRoot } });
    try {
      expect(await restarted.workspaces.listWorkspaces()).toEqual([]);
      const query = await restarted.application.query({
        kind: "projection",
        workspaceId: "workspace",
        perspective: "origin",
      });
      expect(query).toMatchObject({ status: "rejected", error: { code: "workspace-not-found" } });
      const stores = await readdir(join(dataRoot, "workspaces"));
      expect(stores.filter((name) => name.startsWith(".staging-"))).toEqual([]);
      expect(await readdir(join(dataRoot, "adoption-manifests")).catch(() => [])).toEqual([]);
    } finally {
      await restarted.close();
    }
  }, 30_000);

  it("a failed adoption cleans its staging workspace immediately", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-adoption-fail-"));
    temporaryDirectories.push(dataRoot);
    const source = await sourceWithGovernedWorkspace("workspace");

    const registry = new ProposalWorkspaceRegistry();
    const sessions = new WorkspaceSessions(registry, dataRoot);
    const staging = await sessions.stage("ghost");
    const opened = await staging.open();
    // Pulling a workspace the source does not serve yields nothing; discard
    // must remove the staging store synchronously with the failure.
    const exchanged = await new SyncExchange(opened.sync, failingPeer).sync().catch(() => ({ pulled: 0 }));
    expect(exchanged.pulled).toBe(0);
    await staging.discard();
    await sessions.release();
    await source.close();

    const stores = await readdir(join(dataRoot, "workspaces"));
    expect(stores.filter((name) => name.startsWith(".staging-"))).toEqual([]);
  }, 30_000);

  it("a completed adoption is visible, boot-stable, and leaves no manifest", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "lode-adoption-complete-"));
    temporaryDirectories.push(dataRoot);
    const source = await sourceWithGovernedWorkspace("workspace");

    const registry = new ProposalWorkspaceRegistry();
    const sessions = new WorkspaceSessions(registry, dataRoot);
    const staging = await sessions.stage("workspace");
    const opened = await staging.open();
    await new SyncExchange(opened.sync, source.replicas.peer("workspace")).sync();
    await sessions.promoteAdoption("workspace", staging, "Workspace");
    await sessions.release();
    await source.close();

    const restarted = await createEngine({ persistence: { dataRoot } });
    try {
      expect(await restarted.workspaces.listWorkspaces()).toEqual([
        { workspaceId: "workspace", label: "Workspace", state: "active" },
      ]);
      expect(await readdir(join(dataRoot, "adoption-manifests")).catch(() => [])).toEqual([]);
    } finally {
      await restarted.close();
    }
  }, 30_000);
});

const failingPeer = {
  profile: () => Promise.reject(new Error("remote serves nothing")),
  fetch: () => Promise.reject(new Error("remote serves nothing")),
  send: () => Promise.reject(new Error("remote serves nothing")),
};

async function sourceWithGovernedWorkspace(workspaceId: string) {
  const dataRoot = await mkdtemp(join(tmpdir(), "lode-adoption-source-"));
  temporaryDirectories.push(dataRoot);
  const engine = await createEngine({ persistence: { dataRoot } });
  const created = await engine.identity.createActor({ label: "Owner", passphrase: vaultPassphrase });
  await engine.workspaces.createWorkspace({ workspaceId, label: "Workspace", ownerActorId: created.actorId });
  return engine;
}
