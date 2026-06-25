import { bytesToBuffer, openSqliteDatabase, rowBytes, runTransaction } from "./sqlite.js";
import type { SqliteDatabase } from "./sqlite.js";

export type DocRecord = {
  docId: string;
  displayName: string;
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
  private constructor(private readonly db: SqliteDatabase) {}

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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        latest_update_seq INTEGER NOT NULL DEFAULT 0,
        latest_snapshot_seq INTEGER
      );

      CREATE TABLE IF NOT EXISTS crdt_updates (
        doc_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        update_bytes BLOB NOT NULL,
        created_at INTEGER NOT NULL,

        PRIMARY KEY (doc_id, seq),
        FOREIGN KEY (doc_id) REFERENCES docs(doc_id)
      );

      CREATE TABLE IF NOT EXISTS crdt_snapshots (
        doc_id TEXT NOT NULL,
        covered_update_seq INTEGER NOT NULL,
        snapshot_bytes BLOB NOT NULL,
        created_at INTEGER NOT NULL,

        PRIMARY KEY (doc_id, covered_update_seq),
        FOREIGN KEY (doc_id) REFERENCES docs(doc_id)
      );
    `);
    return new WorkspaceStore(db);
  }

  async createDoc(input: {
    docId: string;
    displayName: string;
    snapshotBytes: Uint8Array;
  }): Promise<DocRecord> {
    const now = Date.now();
    await runTransaction(this.db, async () => {
      await this.db.run(
        `INSERT INTO docs
          (doc_id, display_name, created_at, updated_at, latest_update_seq, latest_snapshot_seq)
         VALUES (?, ?, ?, ?, 0, 0)`,
        input.docId,
        input.displayName,
        now,
        now,
      );
      await this.db.run(
        `INSERT INTO crdt_snapshots
          (doc_id, covered_update_seq, snapshot_bytes, created_at)
         VALUES (?, 0, ?, ?)`,
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

  async listDocs(): Promise<string[]> {
    const rows = await this.db.all<{ doc_id: string }[]>(
      "SELECT doc_id FROM docs ORDER BY created_at ASC",
    );
    return rows.map((row) => row.doc_id);
  }

  async getDoc(docId: string): Promise<DocRecord | null> {
    const row = await this.db.get<DocRow>(
      `SELECT doc_id, display_name, created_at, updated_at, latest_update_seq, latest_snapshot_seq
       FROM docs
       WHERE doc_id = ?`,
      docId,
    );
    return row ? rowToDoc(row) : null;
  }

  async removeDoc(docId: string): Promise<boolean> {
    let removed = false;
    await runTransaction(this.db, async () => {
      await this.db.run("DELETE FROM crdt_updates WHERE doc_id = ?", docId);
      await this.db.run("DELETE FROM crdt_snapshots WHERE doc_id = ?", docId);
      const result = await this.db.run("DELETE FROM docs WHERE doc_id = ?", docId);
      removed = (result.changes ?? 0) > 0;
    });
    return removed;
  }

  async appendUpdate(input: { docId: string; updateBytes: Uint8Array }): Promise<number> {
    let nextSeq = 0;
    const now = Date.now();
    await runTransaction(this.db, async () => {
      const doc = await this.getDoc(input.docId);
      if (!doc) {
        throw new Error(`Doc not found: ${input.docId}`);
      }
      nextSeq = doc.latestUpdateSeq + 1;
      await this.db.run(
        `INSERT INTO crdt_updates (doc_id, seq, update_bytes, created_at)
         VALUES (?, ?, ?, ?)`,
        input.docId,
        nextSeq,
        bytesToBuffer(input.updateBytes),
        now,
      );
      await this.db.run(
        `UPDATE docs
         SET latest_update_seq = ?, updated_at = ?
         WHERE doc_id = ?`,
        nextSeq,
        now,
        input.docId,
      );
    });
    return nextSeq;
  }

  async writeSnapshot(input: {
    docId: string;
    coveredUpdateSeq: number;
    snapshotBytes: Uint8Array;
  }): Promise<void> {
    const now = Date.now();
    await runTransaction(this.db, async () => {
      const doc = await this.getDoc(input.docId);
      if (!doc) {
        throw new Error(`Doc not found: ${input.docId}`);
      }
      await this.db.run(
        `INSERT OR REPLACE INTO crdt_snapshots
          (doc_id, covered_update_seq, snapshot_bytes, created_at)
         VALUES (?, ?, ?, ?)`,
        input.docId,
        input.coveredUpdateSeq,
        bytesToBuffer(input.snapshotBytes),
        now,
      );
      await this.db.run(
        `UPDATE docs
         SET latest_snapshot_seq = ?, updated_at = ?
         WHERE doc_id = ?`,
        input.coveredUpdateSeq,
        now,
        input.docId,
      );
    });
  }

  async loadDocBytes(docId: string): Promise<LoadedDocBytes | null> {
    const doc = await this.getDoc(docId);
    if (!doc) {
      return null;
    }

    const snapshotSeq = doc.latestSnapshotSeq;
    const snapshot =
      snapshotSeq == null
        ? null
        : await this.db.get<{ snapshot_bytes: Buffer }>(
            `SELECT snapshot_bytes
             FROM crdt_snapshots
             WHERE doc_id = ? AND covered_update_seq = ?`,
            docId,
            snapshotSeq,
          );
    const coveredSeq = snapshotSeq ?? 0;
    const updates = await this.db.all<{ update_bytes: Buffer }[]>(
      `SELECT update_bytes
       FROM crdt_updates
       WHERE doc_id = ? AND seq > ?
       ORDER BY seq ASC`,
      docId,
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
}

type DocRow = {
  doc_id: string;
  display_name: string;
  created_at: number;
  updated_at: number;
  latest_update_seq: number;
  latest_snapshot_seq: number | null;
};

function rowToDoc(row: DocRow): DocRecord {
  return {
    docId: row.doc_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestUpdateSeq: row.latest_update_seq,
    latestSnapshotSeq: row.latest_snapshot_seq,
  };
}
