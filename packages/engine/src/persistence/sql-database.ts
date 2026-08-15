/**
 * Storage code executes SQL through this async boundary without depending on better-sqlite3.
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

/** View-preserving Uint8Array → Buffer copy for BLOB binding (loro-crdt bytes may be array views). */
export function bytesToBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Wrap a returned BLOB (Buffer) as a plain Uint8Array. */
export function rowBytes(value: Buffer | Uint8Array): Uint8Array {
  return new Uint8Array(value);
}
