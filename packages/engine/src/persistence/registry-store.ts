import { randomUUID } from "node:crypto";
import { registryDbPath, workspaceRelativePath } from "./paths.js";
import { openSqliteDatabase, runTransaction, type SqliteDatabase } from "./sqlite.js";

export type WorkspaceRecord = {
  workspaceId: string;
  displayName: string;
  relativePath: string;
  createdAt: number;
  updatedAt: number;
};

export class RegistryStore {
  private constructor(private readonly db: SqliteDatabase) {}

  static async open(dataRoot: string): Promise<RegistryStore> {
    const db = await openSqliteDatabase(registryDbPath(dataRoot));
    await db.exec(`
      CREATE TABLE IF NOT EXISTS registry_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    return new RegistryStore(db);
  }

  async createWorkspace(input: {
    workspaceId?: string;
    displayName: string;
  }): Promise<WorkspaceRecord> {
    const now = Date.now();
    const workspaceId = input.workspaceId ?? randomUUID();
    const record: WorkspaceRecord = {
      workspaceId,
      displayName: input.displayName,
      relativePath: workspaceRelativePath(workspaceId),
      createdAt: now,
      updatedAt: now,
    };
    await runTransaction(this.db, async () => {
      await this.db.run(
        `INSERT INTO workspaces
          (workspace_id, display_name, relative_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        record.workspaceId,
        record.displayName,
        record.relativePath,
        record.createdAt,
        record.updatedAt,
      );
    });
    return record;
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const rows = await this.db.all<WorkspaceRow[]>(
      `SELECT workspace_id, display_name, relative_path, created_at, updated_at
       FROM workspaces
       ORDER BY created_at ASC`,
    );
    return rows.map(rowToRecord);
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    const row = await this.db.get<WorkspaceRow>(
      `SELECT workspace_id, display_name, relative_path, created_at, updated_at
       FROM workspaces
       WHERE workspace_id = ?`,
      workspaceId,
    );
    return row ? rowToRecord(row) : null;
  }

  async removeWorkspace(workspaceId: string): Promise<boolean> {
    const result = await this.db.run("DELETE FROM workspaces WHERE workspace_id = ?", workspaceId);
    return (result.changes ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

type WorkspaceRow = {
  workspace_id: string;
  display_name: string;
  relative_path: string;
  created_at: number;
  updated_at: number;
};

function rowToRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    workspaceId: row.workspace_id,
    displayName: row.display_name,
    relativePath: row.relative_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
