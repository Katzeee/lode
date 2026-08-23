import type { DocumentStore, DocumentUpdate, LoadedDocumentBytes } from "./document-store.js";

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

  async appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    const [sequence] = await this.appendUpdates([{ id, bytes }]);
    if (sequence === undefined) {
      throw new Error("Document update did not produce a sequence");
    }
    return sequence;
  }

  appendUpdates(inputs: readonly DocumentUpdate[]): Promise<readonly number[]> {
    const staged = new Map([...this.updates].map(([id, updates]) => [id, [...updates]]));
    const sequences: number[] = [];
    for (const { id, bytes } of inputs) {
      const updates = staged.get(id) ?? [];
      updates.push(Uint8Array.from(bytes));
      staged.set(id, updates);
      sequences.push(updates.length);
    }
    this.updates.clear();
    for (const [id, updates] of staged) {
      this.updates.set(id, updates);
    }
    return Promise.resolve(sequences);
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
