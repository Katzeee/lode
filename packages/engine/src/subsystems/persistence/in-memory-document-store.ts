import type { DocumentStore, LoadedDocumentBytes } from "./document-store.js";

export class InMemoryDocumentStore implements DocumentStore {
  private readonly snapshots = new Map<string, Uint8Array>();
  private readonly updates = new Map<string, Uint8Array[]>();

  load(id: string): Promise<LoadedDocumentBytes | null> {
    const snapshot = this.snapshots.get(id) ?? null;
    const updates = this.updates.get(id) ?? [];
    return Promise.resolve(
      snapshot || updates.length > 0
        ? {
            snapshot: snapshot ? Uint8Array.from(snapshot) : null,
            updates: updates.map((update) => Uint8Array.from(update)),
          }
        : null,
    );
  }

  listIds(query: Readonly<{ prefix?: string; after?: string; limit?: number }> = {}): Promise<string[]> {
    const ids = [...new Set([...this.snapshots.keys(), ...this.updates.keys()])]
      .filter(
        (id) =>
          (query.prefix === undefined || id.startsWith(query.prefix)) &&
          (query.after === undefined || id > query.after),
      )
      .sort()
      .slice(0, query.limit);
    return Promise.resolve(ids);
  }

  appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    const updates = this.updates.get(id) ?? [];
    updates.push(Uint8Array.from(bytes));
    this.updates.set(id, updates);
    return Promise.resolve(updates.length);
  }

  writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    this.snapshots.set(id, Uint8Array.from(bytes));
    this.updates.set(id, []);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.snapshots.delete(id);
    this.updates.delete(id);
    return Promise.resolve();
  }
}
