import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteDatabase } from "./better-sqlite-adapter.js";
import { bytesForSql, rowBytes } from "./sql-database.js";

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
      await db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", "ok", bytesForSql(new Uint8Array([1, 2, 3])));
    });

    await expect(
      db.transaction(async () => {
        await db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", "rolled-back", bytesForSql(new Uint8Array([9])));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const ok = await db.get<{ data: Uint8Array }>("SELECT data FROM blobs WHERE id = ?", "ok");
    const rolledBack = await db.get<{ id: string }>("SELECT id FROM blobs WHERE id = ?", "rolled-back");
    expect(ok ? [...rowBytes(ok.data)] : []).toEqual([1, 2, 3]);
    expect(rolledBack).toBeUndefined();
    await db.close();
  });

  it("preserves the transaction failure when rollback also fails", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "be-sqlite-"));
    const db = await openSqliteDatabase(join(tempDir, "test.sqlite"));
    const primary = new Error("primary transaction failure");

    let failure: unknown;
    try {
      await db.transaction(async () => {
        await db.exec("ROLLBACK");
        throw primary;
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    const errors = (failure as AggregateError).errors;
    expect(errors[0]).toBe(primary);
    expect(errors[1]).toBeInstanceOf(Error);
    await db.close();
  });
});
