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

describe("WorkspaceStore — content sub-doc streams", () => {
  it("appends updates in per-sub-doc sequence order", async () => {
    await expect(
      store.appendUpdate({ subDoc: "tree", updateBytes: new Uint8Array([4]) }),
    ).resolves.toBe(1);
    await expect(
      store.appendUpdate({ subDoc: "tree", updateBytes: new Uint8Array([5]) }),
    ).resolves.toBe(2);
    const loaded = await store.loadDocBytes("tree");
    expect(loaded?.updateBytes.map((b) => [...b])).toEqual([[4], [5]]);
  });

  it("loads the latest snapshot plus remaining updates", async () => {
    await store.appendUpdate({ subDoc: "tree", updateBytes: new Uint8Array([1]) });
    await store.appendUpdate({ subDoc: "tree", updateBytes: new Uint8Array([2]) });
    await store.writeSnapshot({
      subDoc: "tree",
      coveredUpdateSeq: 2,
      snapshotBytes: new Uint8Array([9]),
    });
    await store.appendUpdate({ subDoc: "tree", updateBytes: new Uint8Array([3]) });

    const loaded = await store.loadDocBytes("tree");
    expect(loaded?.snapshotBytes ? [...loaded.snapshotBytes] : []).toEqual([9]);
    expect(loaded?.updateBytes.map((b) => [...b])).toEqual([[3]]);
  });

  it("loadDocBytes returns the latest of multiple snapshots", async () => {
    await store.writeSnapshot({
      subDoc: "tree",
      coveredUpdateSeq: 0,
      snapshotBytes: new Uint8Array([1]),
    });
    await store.writeSnapshot({
      subDoc: "tree",
      coveredUpdateSeq: 5,
      snapshotBytes: new Uint8Array([2]),
    });
    const loaded = await store.loadDocBytes("tree");
    expect(loaded?.snapshotBytes ? [...loaded.snapshotBytes] : []).toEqual([2]);
  });

  it("persists independent sub-doc streams (tree + shards), each independently sequenced", async () => {
    await store.appendUpdate({ subDoc: "tree", updateBytes: new Uint8Array([1, 2]) });
    await store.appendUpdate({ subDoc: "s3", updateBytes: new Uint8Array([7]) });
    await store.appendUpdate({ subDoc: "s3", updateBytes: new Uint8Array([8]) });
    await store.appendUpdate({ subDoc: "s17", updateBytes: new Uint8Array([9]) });

    expect((await store.listSubDocs()).sort()).toEqual(["s17", "s3", "tree"]);

    const tree = await store.loadDocBytes("tree");
    expect(tree?.updateBytes.map((b) => [...b])).toEqual([[1, 2]]);
    const s3 = await store.loadDocBytes("s3");
    expect(s3?.updateBytes.map((b) => [...b])).toEqual([[7], [8]]);
    const s17 = await store.loadDocBytes("s17");
    expect(s17?.updateBytes.map((b) => [...b])).toEqual([[9]]);
    // A sub-doc with no rows returns null.
    await expect(store.loadDocBytes("s999")).resolves.toBeNull();
  });
});
