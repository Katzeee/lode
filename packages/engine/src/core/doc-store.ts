import type { SyncBytes } from "./syncable.js";

/**
 * The persistence port (dependency inversion). Core defines the `id → bytes` contract a workspace's
 * doc store MUST honor; the runtime adapts the persistence leaf (sqlite today; a different binding on
 * mobile, a future PG) to it. The leaf stays pure — it knows `id → bytes`, nothing about topology
 * (tree vs shards vs membership), and imports nothing from core. This port is the shape that makes
 * the backend swappable without touching core or anything above it.
 *
 * A doc's persisted bytes are a snapshot (the latest compacted state, or null if none has been taken)
 * plus the incremental updates appended after it. A snapshot-only doc (a shard, the membership log)
 * persists the snapshot and never appends updates; an incremental doc (the outliner tree) uses both.
 * The same port serves both — the caller picks which methods to use.
 */
export type LoadedDocBytes = {
  /** The latest persisted snapshot, or null if none has been taken. */
  readonly snapshot: SyncBytes | null;
  /** Every incremental update appended after the snapshot, in order. */
  readonly updates: SyncBytes[];
};

export type DocStore = {
  /** A doc's bytes (snapshot + post-snapshot updates), or null if the doc has no persisted bytes. */
  load(id: string): Promise<LoadedDocBytes | null>;
  /** Every persisted doc id (the set a workspace restart re-residents from). */
  listIds(): Promise<string[]>;
  /** Append one incremental update for a doc; returns the assigned seq (the snapshot-compaction
   *  trigger uses it). Snapshot-only docs never call this. */
  appendUpdate(id: string, bytes: SyncBytes): Promise<number>;
  /** Write (or overwrite) a doc's snapshot covering its latest state. */
  writeSnapshot(id: string, bytes: SyncBytes): Promise<void>;
};
