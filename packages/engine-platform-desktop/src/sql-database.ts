/**
 * Desktop storage executes SQL through this async boundary without exposing better-sqlite3.
 * SQL remains owned by each store; this interface owns connection and transaction execution.
 */
export type SqlParam = null | number | bigint | string | Uint8Array;

export type SqlDatabase = {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: SqlParam[]): Promise<void>;
  get<T = unknown>(sql: string, ...params: SqlParam[]): Promise<T | undefined>;
  /** `T` is the row shape; returns one row per result. */
  all<T = unknown>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  /** BEGIN IMMEDIATE … COMMIT, ROLLBACK on throw. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

/** Exact-view byte copy for SQL BLOB binding; Loro may return a view into a larger buffer. */
export function bytesForSql(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

export function rowBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}
