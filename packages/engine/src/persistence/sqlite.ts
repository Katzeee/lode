import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";

export type SqliteDatabase = Database<sqlite3.Database, sqlite3.Statement>;

export async function openSqliteDatabase(filePath: string): Promise<SqliteDatabase> {
  await mkdir(dirname(filePath), { recursive: true });
  const db = await open({
    filename: filePath,
    driver: sqlite3.Database,
  });
  await db.exec("PRAGMA foreign_keys = ON");
  await db.exec("PRAGMA journal_mode = WAL");
  return db;
}

export async function runTransaction<T>(db: SqliteDatabase, fn: () => Promise<T>): Promise<T> {
  await db.exec("BEGIN IMMEDIATE");
  try {
    const result = await fn();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

export function bytesToBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function rowBytes(value: Buffer | Uint8Array): Uint8Array {
  return new Uint8Array(value);
}
