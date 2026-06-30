/**
 * The async SQL contract every storage backend implements. The engine talks only to this
 * interface — never to a concrete SQLite binding — so the binding is swappable (better-sqlite3
 * on Node today; expo-sqlite/opsqlite on mobile later; a Postgres adapter in principle) without
 * the stores changing. SQL lives in the stores; this is the execution seam.
 *
 * Methods are async even though the Node binding (better-sqlite3) is synchronous: async is the
 * portable contract (some backends are inherently async), and a sync binding implements it by
 * wrapping its calls in async methods.
 */
export type SqlParam = null | number | bigint | string | Uint8Array;

export type SqlRunResult = { changes: number; lastInsertRowid: number | bigint };

export type SqlDatabase = {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: SqlParam[]): Promise<SqlRunResult>;
  get<T = unknown>(sql: string, ...params: SqlParam[]): Promise<T | undefined>;
  /** `T` is the row shape; returns one row per result. */
  all<T = unknown>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  /** BEGIN IMMEDIATE … COMMIT, ROLLBACK on throw. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

/** View-preserving Uint8Array → Buffer copy for BLOB binding (loro-crdt bytes may be array views). */
export function bytesToBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Wrap a returned BLOB (Buffer) as a plain Uint8Array. */
export function rowBytes(value: Buffer | Uint8Array): Uint8Array {
  return new Uint8Array(value);
}
