/* eslint-disable @typescript-eslint/require-await -- the SqlDatabase contract is async; better-sqlite3 is synchronous, so these wrappers don't await. */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { SqlDatabase, SqlParam } from "./sql-database.js";

/**
 * Adapts the synchronous better-sqlite3 connection to the engine's async SQL boundary.
 * Connection-level SQLite pragmas live here rather than in individual stores.
 */
export async function openSqliteDatabase(filePath: string): Promise<SqlDatabase> {
  await mkdir(dirname(filePath), { recursive: true });
  const raw = new Database(filePath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  return new BetterSqliteDatabase(raw);
}

class BetterSqliteDatabase implements SqlDatabase {
  constructor(private readonly raw: Database.Database) {}

  async exec(sql: string): Promise<void> {
    this.raw.exec(sql);
  }

  async run(sql: string, ...params: SqlParam[]): Promise<void> {
    this.raw.prepare(sql).run(...params);
  }

  async get<T>(sql: string, ...params: SqlParam[]): Promise<T | undefined> {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  async all<T>(sql: string, ...params: SqlParam[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // better-sqlite3's own .transaction() wraps a sync fn and can't await, so drive the tx by hand.
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {
    this.raw.close();
  }
}
