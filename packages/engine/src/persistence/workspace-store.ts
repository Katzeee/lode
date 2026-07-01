/* eslint-disable max-lines -- one persistence boundary; sub-doc stream handling kept together */
import { bytesToBuffer, rowBytes } from "./sql-database.js";
import type { SqlDatabase } from "./sql-database.js";
import { openSqliteDatabase } from "./better-sqlite-adapter.js";

/** The default sub-doc name. Single-doc stores use only this; sharded stores use it for the treeDoc and one sub-doc per shard id. */
export const MAIN_SUBDOC = "main";

/** The doc-kind value for workspace CONTENT docs (the single sharded engine doc). The `docs` table
 *  holds every persisted Loro doc in the workspace sqlite — content AND non-content (e.g. the
 *  membership log). `kind` discriminates them so the content loader loads ONLY content and never
 *  has to know the names of the non-content docs (no magic-string denylist). */
export const CONTENT_DOC_KIND = "content";

export type DocRecord = {
  docId: string;
  displayName: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
  latestUpdateSeq: number;
  latestSnapshotSeq: number | null;
};

export type LoadedDocBytes = {
  snapshotBytes: Uint8Array | null;
  updateBytes: Uint8Array[];
};

export class WorkspaceStore {
  private constructor(private readonly db: SqlDatabase) {}

  static async open(filePath: string): Promise<WorkspaceStore> {
    const db = await openSqliteDatabase(filePath);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS docs (
        doc_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT '${CONTENT_DOC_KIND}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        latest_update_seq INTEGER NOT NULL DEFAULT 0,
        latest_snapshot_seq INTEGER
      );

      CREATE TABLE IF NOT EXISTS crdt_updates (
        doc_id TEXT NOT NULL,
        sub_doc TEXT NOT NULL DEFAULT '${MAIN_SUBDOC}',
        seq INTEGER NOT NULL,
        update_bytes BLOB NOT NULL,
        created_at INTEGER NOT NULL,

        PRIMARY KEY (doc_id, sub_doc, seq),
        FOREIGN KEY (doc_id) REFERENCES docs(doc_id)
      );

      CREATE TABLE IF NOT EXISTS crdt_snapshots (
        doc_id TEXT NOT NULL,
        sub_doc TEXT NOT NULL DEFAULT '${MAIN_SUBDOC}',
        covered_update_seq INTEGER NOT NULL,
        snapshot_bytes BLOB NOT NULL,
        created_at INTEGER NOT NULL,

        PRIMARY KEY (doc_id, sub_doc, covered_update_seq),
        FOREIGN KEY (doc_id) REFERENCES docs(doc_id)
      );
    `);
    await migrateSubDocColumn(db);
    await migrateKindColumn(db);
    return new WorkspaceStore(db);
  }

  async createDoc(input: {
    docId: string;
    displayName: string;
    snapshotBytes: Uint8Array;
    /** Doc kind; defaults to content. Non-content docs (e.g. the membership log) pass their own kind
     *  so the content loader never loads them. */
    kind?: string;
  }): Promise<DocRecord> {
    const now = Date.now();
    const kind = input.kind ?? CONTENT_DOC_KIND;
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO docs
          (doc_id, display_name, kind, created_at, updated_at, latest_update_seq, latest_snapshot_seq)
         VALUES (?, ?, ?, ?, ?, 0, 0)`,
        input.docId,
        input.displayName,
        kind,
        now,
        now,
      );
      await this.db.run(
        `INSERT INTO crdt_snapshots
          (doc_id, sub_doc, covered_update_seq, snapshot_bytes, created_at)
         VALUES (?, '${MAIN_SUBDOC}', 0, ?, ?)`,
        input.docId,
        bytesToBuffer(input.snapshotBytes),
        now,
      );
    });
    const record = await this.getDoc(input.docId);
    if (!record) {
      throw new Error(`Doc was not created: ${input.docId}`);
    }
    return record;
  }

  /** All doc ids, optionally filtered by kind. Callers that iterate CONTENT (e.g. workspace load)
   *  pass `kind = CONTENT_DOC_KIND` so non-content docs (the membership log) are excluded without the
   *  loader having to know their names. */
  async listDocs(kind?: string): Promise<string[]> {
    const rows =
      kind === undefined
        ? await this.db.all<{ doc_id: string }>("SELECT doc_id FROM docs ORDER BY created_at ASC")
        : await this.db.all<{ doc_id: string }>(
            "SELECT doc_id FROM docs WHERE kind = ? ORDER BY created_at ASC",
            kind,
          );
    return rows.map((row) => row.doc_id);
  }

  /** Read a workspace_meta value (null if absent). Used to persist the store kind. */
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

  /** Distinct sub-doc names that have any persisted bytes for a doc (incl. the main sub-doc). */
  async listSubDocs(docId: string): Promise<string[]> {
    const rows = await this.db.all<{ sub_doc: string }>(
      `SELECT DISTINCT sub_doc FROM (
          SELECT sub_doc FROM crdt_updates WHERE doc_id = ?
          UNION
          SELECT sub_doc FROM crdt_snapshots WHERE doc_id = ?
       )
       ORDER BY sub_doc ASC`,
      docId,
      docId,
    );
    return rows.map((row) => row.sub_doc);
  }

  async getDoc(docId: string): Promise<DocRecord | null> {
    const row = await this.db.get<DocRow>(
      `SELECT doc_id, display_name, kind, created_at, updated_at, latest_update_seq, latest_snapshot_seq
       FROM docs
       WHERE doc_id = ?`,
      docId,
    );
    return row ? rowToDoc(row) : null;
  }

  async removeDoc(docId: string): Promise<boolean> {
    let removed = false;
    await this.db.transaction(async () => {
      await this.db.run("DELETE FROM crdt_updates WHERE doc_id = ?", docId);
      await this.db.run("DELETE FROM crdt_snapshots WHERE doc_id = ?", docId);
      const result = await this.db.run("DELETE FROM docs WHERE doc_id = ?", docId);
      removed = (result.changes ?? 0) > 0;
    });
    return removed;
  }

  async appendUpdate(input: {
    docId: string;
    updateBytes: Uint8Array;
    subDoc?: string;
  }): Promise<number> {
    const subDoc = input.subDoc ?? MAIN_SUBDOC;
    let nextSeq = 0;
    const now = Date.now();
    await this.db.transaction(async () => {
      const doc = await this.getDoc(input.docId);
      if (!doc) {
        throw new Error(`Doc not found: ${input.docId}`);
      }
      const latest = await this.latestSeq(input.docId, subDoc);
      nextSeq = latest + 1;
      await this.db.run(
        `INSERT INTO crdt_updates (doc_id, sub_doc, seq, update_bytes, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        input.docId,
        subDoc,
        nextSeq,
        bytesToBuffer(input.updateBytes),
        now,
      );
      // docs.latest_*_seq tracks the main sub-doc (back-compat with single-doc callers).
      if (subDoc === MAIN_SUBDOC) {
        await this.db.run(
          `UPDATE docs SET latest_update_seq = ?, updated_at = ? WHERE doc_id = ?`,
          nextSeq,
          now,
          input.docId,
        );
      }
    });
    return nextSeq;
  }

  async writeSnapshot(input: {
    docId: string;
    coveredUpdateSeq: number;
    snapshotBytes: Uint8Array;
    subDoc?: string;
  }): Promise<void> {
    const subDoc = input.subDoc ?? MAIN_SUBDOC;
    const now = Date.now();
    await this.db.transaction(async () => {
      const doc = await this.getDoc(input.docId);
      if (!doc) {
        throw new Error(`Doc not found: ${input.docId}`);
      }
      await this.db.run(
        `INSERT INTO crdt_snapshots
          (doc_id, sub_doc, covered_update_seq, snapshot_bytes, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(doc_id, sub_doc, covered_update_seq) DO UPDATE SET
           snapshot_bytes = excluded.snapshot_bytes,
           created_at = excluded.created_at`,
        input.docId,
        subDoc,
        input.coveredUpdateSeq,
        bytesToBuffer(input.snapshotBytes),
        now,
      );
      if (subDoc === MAIN_SUBDOC) {
        await this.db.run(
          `UPDATE docs SET latest_snapshot_seq = ?, updated_at = ? WHERE doc_id = ?`,
          input.coveredUpdateSeq,
          now,
          input.docId,
        );
      }
    });
  }

  async loadDocBytes(docId: string, subDoc?: string): Promise<LoadedDocBytes | null> {
    const sd = subDoc ?? MAIN_SUBDOC;
    const doc = await this.getDoc(docId);
    if (!doc) {
      return null;
    }
    const latest = await this.latestSeq(docId, sd);
    if (latest === 0 && sd !== MAIN_SUBDOC) {
      // Non-main sub-doc with no rows: nothing persisted (e.g., a shard never touched).
      const hasRows = await this.db.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM crdt_snapshots WHERE doc_id = ? AND sub_doc = ?`,
        docId,
        sd,
      );
      if (!(hasRows && hasRows.c > 0)) {
        return null;
      }
    }
    const snapshotSeq =
      sd === MAIN_SUBDOC ? doc.latestSnapshotSeq : await this.latestSnapshotSeq(docId, sd);
    const snapshot =
      snapshotSeq == null
        ? null
        : await this.db.get<{ snapshot_bytes: Buffer }>(
            `SELECT snapshot_bytes
             FROM crdt_snapshots
             WHERE doc_id = ? AND sub_doc = ? AND covered_update_seq = ?`,
            docId,
            sd,
            snapshotSeq,
          );
    const coveredSeq = snapshotSeq ?? 0;
    const updates = await this.db.all<{ update_bytes: Buffer }>(
      `SELECT update_bytes
       FROM crdt_updates
       WHERE doc_id = ? AND sub_doc = ? AND seq > ?
       ORDER BY seq ASC`,
      docId,
      sd,
      coveredSeq,
    );

    return {
      snapshotBytes: snapshot ? rowBytes(snapshot.snapshot_bytes) : null,
      updateBytes: updates.map((row) => rowBytes(row.update_bytes)),
    };
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  /** Highest update seq for a (doc, sub-doc), or 0 if none. */
  private async latestSeq(docId: string, subDoc: string): Promise<number> {
    const row = await this.db.get<{ seq: number }>(
      `SELECT MAX(seq) AS seq FROM crdt_updates WHERE doc_id = ? AND sub_doc = ?`,
      docId,
      subDoc,
    );
    return row?.seq ?? 0;
  }

  /** Highest covered_update_seq for a (doc, sub-doc), or null if no snapshot. */
  private async latestSnapshotSeq(docId: string, subDoc: string): Promise<number | null> {
    const row = await this.db.get<{ seq: number }>(
      `SELECT MAX(covered_update_seq) AS seq FROM crdt_snapshots WHERE doc_id = ? AND sub_doc = ?`,
      docId,
      subDoc,
    );
    return row?.seq ?? null;
  }
}

type DocRow = {
  doc_id: string;
  display_name: string;
  kind: string;
  created_at: number;
  updated_at: number;
  latest_update_seq: number;
  latest_snapshot_seq: number | null;
};

function rowToDoc(row: DocRow): DocRecord {
  return {
    docId: row.doc_id,
    displayName: row.display_name,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestUpdateSeq: row.latest_update_seq,
    latestSnapshotSeq: row.latest_snapshot_seq,
  };
}

/**
 * Migration: older dev schemas lacked the `sub_doc` column (and used a (doc_id, seq) PK).
 * Rebuild the CRDT tables to the sub-doc schema. DROPS existing CRDT bytes — dev workspaces
 * are recreated on next open. A no-op when the column already exists.
 */
async function migrateSubDocColumn(db: SqlDatabase): Promise<void> {
  const cols = await db.all<{ name: string }>(`PRAGMA table_info(crdt_updates)`);
  const hasSubDoc = cols.some((c) => c.name === "sub_doc");
  if (hasSubDoc) {
    return;
  }
  await db.exec(`
    DROP TABLE IF EXISTS crdt_updates;
    DROP TABLE IF EXISTS crdt_snapshots;
    CREATE TABLE IF NOT EXISTS crdt_updates (
      doc_id TEXT NOT NULL,
      sub_doc TEXT NOT NULL DEFAULT '${MAIN_SUBDOC}',
      seq INTEGER NOT NULL,
      update_bytes BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (doc_id, sub_doc, seq),
      FOREIGN KEY (doc_id) REFERENCES docs(doc_id)
    );
    CREATE TABLE IF NOT EXISTS crdt_snapshots (
      doc_id TEXT NOT NULL,
      sub_doc TEXT NOT NULL DEFAULT '${MAIN_SUBDOC}',
      covered_update_seq INTEGER NOT NULL,
      snapshot_bytes BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (doc_id, sub_doc, covered_update_seq),
      FOREIGN KEY (doc_id) REFERENCES docs(doc_id)
    );
  `);
}

/**
 * Migration: add the `kind` column to `docs` (discriminates content from non-content docs like the
 * membership log). Existing rows predate the column → backfill 'content' (every pre-existing doc WAS
 * content). A no-op when the column already exists.
 */
async function migrateKindColumn(db: SqlDatabase): Promise<void> {
  const cols = await db.all<{ name: string }>(`PRAGMA table_info(docs)`);
  if (cols.some((c) => c.name === "kind")) {
    return;
  }
  await db.exec(`ALTER TABLE docs ADD COLUMN kind TEXT NOT NULL DEFAULT '${CONTENT_DOC_KIND}'`);
}
