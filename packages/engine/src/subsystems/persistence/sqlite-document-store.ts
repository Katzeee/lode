import type { DocumentStore, LoadedDocumentBytes } from "./document-store.js";
import type { SqliteWorkspaceStore } from "./sqlite-workspace-store.js";

export class SqliteDocumentStore implements DocumentStore {
  constructor(private readonly store: SqliteWorkspaceStore) {}

  async load(id: string): Promise<LoadedDocumentBytes | null> {
    const bytes = await this.store.loadDocBytes(id);
    return bytes ? { snapshot: bytes.snapshotBytes, updates: bytes.updateBytes } : null;
  }

  listIds(query?: Readonly<{ prefix?: string; after?: string; limit?: number }>): Promise<string[]> {
    return this.store.listSubDocs(query);
  }

  appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    return this.store.appendUpdate({ subDoc: id, updateBytes: bytes });
  }

  async writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    const coveredUpdateSeq = await this.store.latestSeq(id);
    await this.store.writeSnapshot({ subDoc: id, coveredUpdateSeq, snapshotBytes: bytes });
  }

  delete(id: string): Promise<void> {
    return this.store.deleteSubDoc(id);
  }
}
