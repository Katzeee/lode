import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTENT_DOC_KIND, WorkspaceStore } from "./workspace-store.js";

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

  it("persists multiple independent sub-doc streams per logical doc (sharded treeDoc + shards)", async () => {
    await store.createDoc({
      docId: "ws1",
      displayName: "WS",
      snapshotBytes: new Uint8Array([0]), // main sub-doc (treeDoc) initial snapshot
    });

    // The main sub-doc and named shard sub-docs each have their own seq space + streams.
    await store.appendUpdate({ docId: "ws1", updateBytes: new Uint8Array([1, 2]) });
    await store.appendUpdate({ docId: "ws1", subDoc: "s3", updateBytes: new Uint8Array([7]) });
    await store.appendUpdate({ docId: "ws1", subDoc: "s3", updateBytes: new Uint8Array([8]) });
    await store.appendUpdate({ docId: "ws1", subDoc: "s17", updateBytes: new Uint8Array([9]) });

    // listSubDocs enumerates every sub-doc with persisted bytes.
    expect(await store.listSubDocs("ws1")).toEqual(["main", "s17", "s3"]);

    // Each sub-doc loads its own stream, independently sequenced.
    const main = await store.loadDocBytes("ws1");
    expect(main?.updateBytes.map((b) => [...b])).toEqual([[1, 2]]);
    const s3 = await store.loadDocBytes("ws1", "s3");
    expect(s3?.updateBytes.map((b) => [...b])).toEqual([[7], [8]]);
    const s17 = await store.loadDocBytes("ws1", "s17");
    expect(s17?.updateBytes.map((b) => [...b])).toEqual([[9]]);
    // A sub-doc with no rows returns null.
    await expect(store.loadDocBytes("ws1", "s999")).resolves.toBeNull();
  });

  it("discriminates docs by kind (content loader sees only content)", async () => {
    await store.createDoc({
      docId: "main",
      displayName: "Main",
      snapshotBytes: new Uint8Array([0]),
    }); // defaults to content
    await store.createDoc({
      docId: "membership",
      displayName: "membership",
      kind: "membership",
      snapshotBytes: new Uint8Array([0]),
    });

    await expect(store.getDoc("main")).resolves.toMatchObject({ kind: "content" });
    await expect(store.getDoc("membership")).resolves.toMatchObject({ kind: "membership" });

    // Unfiltered lists every doc; filtering by kind keeps non-content docs (the membership log) out
    // of the content loader without it having to know their names.
    expect((await store.listDocs()).sort()).toEqual(["main", "membership"]);
    await expect(store.listDocs(CONTENT_DOC_KIND)).resolves.toEqual(["main"]);
    await expect(store.listDocs("membership")).resolves.toEqual(["membership"]);
  });
});
