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
