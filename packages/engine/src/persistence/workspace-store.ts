import { bytesToBuffer, rowBytes } from "./sql-database.js";
import type { SqlDatabase } from "./sql-database.js";
import { openSqliteDatabase } from "./better-sqlite-adapter.js";

/**
 * The per-workspace sqlite store. Holds the workspace's CRDT bytes keyed by `sub_doc` (the sync
 * channel id) + a per-sub-doc seq — there is no level-2 `doc_id`: a workspace IS one outliner, so
 * the doc axis collapsed away. The tree sub-doc persists incrementally (update stream + periodic
 * snapshots); shards AND the membership log persist as their latest snapshot only. Membership is a
 * content sub-doc under its own id (no separate table) — one shape, id → bytes.
 *
 * The store is a persistence leaf: it knows bytes + ids, nothing about CRDTs or the outliner. Ids
 * (including the `sys:` structure prefix) arrive opaque from the runtime; this layer does not parse
 * them and may not import core.
 */
export class WorkspaceStore {
  private constructor(private readonly db: SqlDatabase) {}

  static async open(filePath: string): Promise<WorkspaceStore> {
    const db = await openSqliteDatabase(filePath);
    await db.exec(`
      DROP TABLE IF EXISTS docs;
      DROP TABLE IF EXISTS crdt_updates;
      DROP TABLE IF EXISTS crdt_snapshots;
      DROP TABLE IF EXISTS membership;

      CREATE TABLE IF NOT EXISTS workspace_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_updates (
        sub_doc TEXT NOT NULL,
        seq INTEGER NOT NULL,
        update_bytes BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (sub_doc, seq)
      );

      CREATE TABLE IF NOT EXISTS content_snapshots (
        sub_doc TEXT NOT NULL,
        covered_update_seq INTEGER NOT NULL,
        snapshot_bytes BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (sub_doc, covered_update_seq)
      );
    `);
    return new WorkspaceStore(db);
  }

  /** Read a workspace_meta value (null if absent). */
  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.get<{ value: string }>(
      "SELECT value FROM workspace_meta WHERE key = ?",
      key,
    );
    return row?.value ?? null;
  }

  /** Write a workspace_meta value. */
  async setMeta(key: string, value: string): Promise<void> {
    await this.db.run(
      "INSERT OR REPLACE INTO workspace_meta (key, value) VALUES (?, ?)",
      key,
      value,
    );
  }

  /** Append one incremental update for a content sub-doc; returns the assigned seq. */
  async appendUpdate(input: { subDoc: string; updateBytes: Uint8Array }): Promise<number> {
    const nextSeq = (await this.latestSeq(input.subDoc)) + 1;
    await this.db.run(
      `INSERT INTO content_updates (sub_doc, seq, update_bytes, created_at)
       VALUES (?, ?, ?, ?)`,
      input.subDoc,
      nextSeq,
      bytesToBuffer(input.updateBytes),
      Date.now(),
    );
    return nextSeq;
  }

  /** Write (or overwrite) a snapshot for a content sub-doc covering up to `coveredUpdateSeq`. */
  async writeSnapshot(input: {
    subDoc: string;
    coveredUpdateSeq: number;
    snapshotBytes: Uint8Array;
  }): Promise<void> {
    await this.db.run(
      `INSERT INTO content_snapshots (sub_doc, covered_update_seq, snapshot_bytes, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(sub_doc, covered_update_seq) DO UPDATE SET
         snapshot_bytes = excluded.snapshot_bytes,
         created_at = excluded.created_at`,
      input.subDoc,
      input.coveredUpdateSeq,
      bytesToBuffer(input.snapshotBytes),
      Date.now(),
    );
  }

  /** Load a content sub-doc's bytes: the latest snapshot (null if none) + every update after it.
   *  Null if the sub-doc has no persisted bytes at all. */
  async loadDocBytes(subDoc: string): Promise<LoadedDocBytes | null> {
    const latest = await this.latestSeq(subDoc);
    const snapshotSeq = await this.latestSnapshotSeq(subDoc);
    if (latest === 0 && snapshotSeq === null) {
      return null;
    }
    const coveredSeq = snapshotSeq ?? 0;
    const snapshot =
      snapshotSeq === null
        ? null
        : await this.db.get<{ snapshot_bytes: Buffer }>(
            `SELECT snapshot_bytes
             FROM content_snapshots
             WHERE sub_doc = ? AND covered_update_seq = ?`,
            subDoc,
            snapshotSeq,
          );
    const updates = await this.db.all<{ update_bytes: Buffer }>(
      `SELECT update_bytes
       FROM content_updates
       WHERE sub_doc = ? AND seq > ?
       ORDER BY seq ASC`,
      subDoc,
      coveredSeq,
    );
    return {
      snapshotBytes: snapshot ? rowBytes(snapshot.snapshot_bytes) : null,
      updateBytes: updates.map((row) => rowBytes(row.update_bytes)),
    };
  }

  /** Distinct content sub-doc names that have any persisted bytes. */
  async listSubDocs(): Promise<string[]> {
    const rows = await this.db.all<{ sub_doc: string }>(
      `SELECT DISTINCT sub_doc FROM (
          SELECT sub_doc FROM content_updates
          UNION
          SELECT sub_doc FROM content_snapshots
       )
       ORDER BY sub_doc ASC`,
    );
    return rows.map((row) => row.sub_doc);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  /** Highest update seq for a sub-doc, or 0 if none. Public so the runtime's `DocStore` adapter can
   *  supply a snapshot's `coveredUpdateSeq` (the leaf's own latest-seq) without the port exposing it. */
  async latestSeq(subDoc: string): Promise<number> {
    const row = await this.db.get<{ seq: number }>(
      `SELECT MAX(seq) AS seq FROM content_updates WHERE sub_doc = ?`,
      subDoc,
    );
    return row?.seq ?? 0;
  }

  /** Highest covered_update_seq for a sub-doc, or null if no snapshot. */
  private async latestSnapshotSeq(subDoc: string): Promise<number | null> {
    const row = await this.db.get<{ seq: number }>(
      `SELECT MAX(covered_update_seq) AS seq FROM content_snapshots WHERE sub_doc = ?`,
      subDoc,
    );
    return row?.seq ?? null;
  }
}

export type LoadedDocBytes = {
  snapshotBytes: Uint8Array | null;
  updateBytes: Uint8Array[];
};
