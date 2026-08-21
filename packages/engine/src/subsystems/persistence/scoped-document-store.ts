import type { DocumentStore, LoadedDocumentBytes } from "./document-store.js";

export class ScopedDocumentStore implements DocumentStore {
  constructor(
    private readonly documents: DocumentStore,
    private readonly namespace: string,
  ) {}

  load(id: string): Promise<LoadedDocumentBytes | null> {
    return this.documents.load(this.scoped(id));
  }

  async listIds(query: Readonly<{ prefix?: string; after?: string; limit?: number }> = {}): Promise<string[]> {
    const prefix = this.scoped(query.prefix ?? "");
    const after = query.after === undefined ? undefined : this.scoped(query.after);
    return (await this.documents.listIds({ ...query, prefix, after })).map((id) => id.slice(this.namespace.length + 1));
  }

  appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    return this.documents.appendUpdate(this.scoped(id), bytes);
  }

  writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    return this.documents.writeSnapshot(this.scoped(id), bytes);
  }

  delete(id: string): Promise<void> {
    return this.documents.delete(this.scoped(id));
  }

  private scoped(id: string): string {
    return `${this.namespace}/${id}`;
  }
}
