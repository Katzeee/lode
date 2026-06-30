import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteDatabase } from "./better-sqlite-adapter.js";
import { bytesToBuffer, rowBytes } from "./sql-database.js";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("SqlDatabase (better-sqlite3 adapter)", () => {
  it("opens databases, stores blobs, and rolls back failed transactions", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "be-sqlite-"));
    const db = await openSqliteDatabase(join(tempDir, "test.sqlite"));
    await db.exec("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB NOT NULL)");

    await db.transaction(async () => {
      await db.run(
        "INSERT INTO blobs (id, data) VALUES (?, ?)",
        "ok",
        bytesToBuffer(new Uint8Array([1, 2, 3])),
      );
    });

    await expect(
      db.transaction(async () => {
        await db.run(
          "INSERT INTO blobs (id, data) VALUES (?, ?)",
          "rolled-back",
          bytesToBuffer(new Uint8Array([9])),
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const ok = await db.get<{ data: Buffer }>("SELECT data FROM blobs WHERE id = ?", "ok");
    const rolledBack = await db.get<{ id: string }>(
      "SELECT id FROM blobs WHERE id = ?",
      "rolled-back",
    );
    expect(ok ? [...rowBytes(ok.data)] : []).toEqual([1, 2, 3]);
    expect(rolledBack).toBeUndefined();
    await db.close();
  });

  it("reports changed-row count from run()", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "be-sqlite-"));
    const db = await openSqliteDatabase(join(tempDir, "test.sqlite"));
    await db.exec("CREATE TABLE t (k TEXT PRIMARY KEY)");

    expect((await db.run("INSERT INTO t (k) VALUES (?)", "a")).changes).toBe(1);
    expect((await db.run("DELETE FROM t WHERE k = ?", "a")).changes).toBe(1);
    expect((await db.run("DELETE FROM t WHERE k = ?", "missing")).changes).toBe(0);
    await db.close();
  });
});
