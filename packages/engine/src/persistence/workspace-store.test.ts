import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceStore } from "./workspace-store.js";

let tempDir: string;
let store: WorkspaceStore;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "be-workspace-"));
  store = await WorkspaceStore.open(join(tempDir, "workspace.sqlite"));
});

afterEach(async () => {
  await store.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("WorkspaceStore", () => {
  it("creates docs with initial snapshots", async () => {
    await store.createDoc({
      docId: "main",
      displayName: "Main",
      snapshotBytes: new Uint8Array([1, 2, 3]),
    });

    await expect(store.listDocs()).resolves.toEqual(["main"]);
    await expect(store.getDoc("main")).resolves.toMatchObject({
      docId: "main",
      displayName: "Main",
      latestUpdateSeq: 0,
      latestSnapshotSeq: 0,
    });
    await expect(store.loadDocBytes("main")).resolves.toMatchObject({
      snapshotBytes: new Uint8Array([1, 2, 3]),
      updateBytes: [],
    });
  });

  it("appends updates in doc-local sequence order", async () => {
    await store.createDoc({
      docId: "main",
      displayName: "Main",
      snapshotBytes: new Uint8Array([0]),
    });

    await expect(
      store.appendUpdate({ docId: "main", updateBytes: new Uint8Array([4]) }),
    ).resolves.toBe(1);
    await expect(
      store.appendUpdate({ docId: "main", updateBytes: new Uint8Array([5]) }),
    ).resolves.toBe(2);

    const loaded = await store.loadDocBytes("main");
    expect(loaded?.updateBytes.map((bytes) => [...bytes])).toEqual([[4], [5]]);
    await expect(store.getDoc("main")).resolves.toMatchObject({ latestUpdateSeq: 2 });
  });

  it("loads latest snapshot plus remaining updates", async () => {
    await store.createDoc({
      docId: "main",
      displayName: "Main",
      snapshotBytes: new Uint8Array([0]),
    });
    await store.appendUpdate({ docId: "main", updateBytes: new Uint8Array([1]) });
    await store.appendUpdate({ docId: "main", updateBytes: new Uint8Array([2]) });
    await store.writeSnapshot({
      docId: "main",
      coveredUpdateSeq: 2,
      snapshotBytes: new Uint8Array([9]),
    });
    await store.appendUpdate({ docId: "main", updateBytes: new Uint8Array([3]) });

    const loaded = await store.loadDocBytes("main");

    expect(loaded?.snapshotBytes ? [...loaded.snapshotBytes] : []).toEqual([9]);
    expect(loaded?.updateBytes.map((bytes) => [...bytes])).toEqual([[3]]);
    await expect(store.getDoc("main")).resolves.toMatchObject({ latestSnapshotSeq: 2 });
  });

  it("removes docs and their CRDT rows", async () => {
    await store.createDoc({
      docId: "main",
      displayName: "Main",
      snapshotBytes: new Uint8Array([0]),
    });
    await store.appendUpdate({ docId: "main", updateBytes: new Uint8Array([1]) });

    await expect(store.removeDoc("main")).resolves.toBe(true);
    await expect(store.removeDoc("main")).resolves.toBe(false);
    await expect(store.listDocs()).resolves.toEqual([]);
    await expect(store.loadDocBytes("main")).resolves.toBeNull();
  });
});
