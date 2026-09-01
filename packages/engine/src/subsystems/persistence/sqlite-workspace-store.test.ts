import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSqliteDatabase } from "./better-sqlite-adapter.js";
import { SqliteWorkspaceStore } from "./sqlite-workspace-store.js";

let tempDir: string;
let filePath: string;
let store: SqliteWorkspaceStore;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "be-workspace-"));
  filePath = join(tempDir, "workspace.sqlite");
  store = await SqliteWorkspaceStore.open(filePath);
});

afterEach(async () => {
  await store.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("SqliteWorkspaceStore — content sub-doc streams", () => {
  it("appends updates in per-sub-doc sequence order", async () => {
    await expect(store.appendUpdate({ subDoc: "tree", updateBytes: new Uint8Array([4]) })).resolves.toBe(1);
    await expect(store.appendUpdate({ subDoc: "tree", updateBytes: new Uint8Array([5]) })).resolves.toBe(2);
    const loaded = await store.loadDocBytes("tree");
    expect(loaded?.updateBytes.map((b) => [...b])).toEqual([[4], [5]]);
  });

  it("rolls back every document when one update in an atomic append fails", async () => {
    const database = await openSqliteDatabase(filePath);
    await database.exec(`
      CREATE TRIGGER reject_receipts
      BEFORE INSERT ON content_updates
      WHEN NEW.sub_doc = 'receipts'
      BEGIN
        SELECT RAISE(ABORT, 'injected receipt failure');
      END;
    `);
    await database.close();

    await expect(
      store.appendUpdates([
        { subDoc: "facts", updateBytes: new Uint8Array([1]) },
        { subDoc: "receipts", updateBytes: new Uint8Array([2]) },
      ]),
    ).rejects.toThrow("injected receipt failure");
    await expect(store.loadDocBytes("facts")).resolves.toBeNull();
    await expect(store.loadDocBytes("receipts")).resolves.toBeNull();
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

  it("atomically removes covered updates and superseded snapshots", async () => {
    await store.appendUpdate({ subDoc: "facts", updateBytes: new Uint8Array([1]) });
    await store.appendUpdate({ subDoc: "facts", updateBytes: new Uint8Array([2]) });
    await store.writeSnapshot({
      subDoc: "facts",
      coveredUpdateSeq: 2,
      snapshotBytes: new Uint8Array([20]),
    });
    await expect(store.appendUpdate({ subDoc: "facts", updateBytes: new Uint8Array([3]) })).resolves.toBe(3);
    await store.writeSnapshot({
      subDoc: "facts",
      coveredUpdateSeq: 3,
      snapshotBytes: new Uint8Array([30]),
    });

    const database = await openSqliteDatabase(filePath);
    const updates = await database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM content_updates WHERE sub_doc = ?",
      "facts",
    );
    const snapshots = await database.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM content_snapshots WHERE sub_doc = ?",
      "facts",
    );
    await database.close();
    expect(updates?.count).toBe(0);
    expect(snapshots?.count).toBe(1);

    await store.close();
    store = await SqliteWorkspaceStore.open(filePath);
    await expect(store.appendUpdate({ subDoc: "facts", updateBytes: new Uint8Array([4]) })).resolves.toBe(4);
    const loaded = await store.loadDocBytes("facts");
    expect(loaded?.snapshotBytes ? [...loaded.snapshotBytes] : []).toEqual([30]);
    expect(loaded?.updateBytes.map((bytes) => [...bytes])).toEqual([[4]]);
  });

  it("persists independent opaque document streams with separate sequences", async () => {
    await store.appendUpdate({ subDoc: "tree", updateBytes: new Uint8Array([1, 2]) });
    await store.appendUpdate({ subDoc: "s3", updateBytes: new Uint8Array([7]) });
    await store.appendUpdate({ subDoc: "s3", updateBytes: new Uint8Array([8]) });
    await store.appendUpdate({ subDoc: "s17", updateBytes: new Uint8Array([9]) });

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
