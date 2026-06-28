import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workspaceRelativePath } from "./paths.js";
import { RegistryStore } from "./registry-store.js";

let tempDir: string;
let store: RegistryStore;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "be-registry-"));
  store = await RegistryStore.open(tempDir);
});

afterEach(async () => {
  await store.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("RegistryStore", () => {
  it("initializes an empty registry without workspaces", async () => {
    await expect(store.listWorkspaces()).resolves.toEqual([]);
  });

  it("creates and lists workspace records", async () => {
    const created = await store.createWorkspace({
      workspaceId: "ws-main",
      displayName: "Personal",
    });

    expect(created.relativePath).toBe(workspaceRelativePath("ws-main"));
    await expect(store.listWorkspaces()).resolves.toMatchObject([
      { workspaceId: "ws-main", displayName: "Personal" },
    ]);
    await expect(store.getWorkspace("ws-main")).resolves.toMatchObject({
      workspaceId: "ws-main",
      displayName: "Personal",
    });
  });

  it("unregisters workspace records without deleting workspace files", async () => {
    await store.createWorkspace({ workspaceId: "ws-main", displayName: "Personal" });

    await expect(store.removeWorkspace("ws-main")).resolves.toBe(true);
    await expect(store.removeWorkspace("ws-main")).resolves.toBe(false);
    await expect(store.listWorkspaces()).resolves.toEqual([]);
  });
});

describe("RegistryStore peerId", () => {
  it("generates a stable, positive peerId and persists it across reopen", async () => {
    const first = await store.ensurePeerId();
    expect(Number.isSafeInteger(first)).toBe(true);
    expect(first).toBeGreaterThan(0);

    // Persisted: a fresh store over the same dataRoot returns the same value.
    await store.close();
    store = await RegistryStore.open(tempDir);
    await expect(store.ensurePeerId()).resolves.toBe(first);
  });

  it("different dataRoots get different peerIds", async () => {
    const a = await store.ensurePeerId();
    const otherDir = await mkdtemp(join(tmpdir(), "be-registry-2-"));
    try {
      const other = await RegistryStore.open(otherDir);
      const b = await other.ensurePeerId();
      expect(b).not.toBe(a);
      await other.close();
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});
