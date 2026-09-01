import type { DocumentStore, DocumentUpdate, LoadedDocumentBytes } from "./document-store.js";

export class ScopedDocumentStore implements DocumentStore {
  constructor(
    private readonly documents: DocumentStore,
    private readonly namespace: string,
  ) {}

  load(id: string): Promise<LoadedDocumentBytes | null> {
    return this.documents.load(this.scoped(id));
  }

  appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    return this.documents.appendUpdate(this.scoped(id), bytes);
  }

  appendUpdates(updates: readonly DocumentUpdate[]): Promise<readonly number[]> {
    return this.documents.appendUpdates(updates.map(({ id, bytes }) => ({ id: this.scoped(id), bytes })));
  }

  writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    return this.documents.writeSnapshot(this.scoped(id), bytes);
  }

  private scoped(id: string): string {
    return `${this.namespace}/${id}`;
  }
}
