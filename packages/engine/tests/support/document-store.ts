import type {
  DocumentStore,
  DocumentUpdate,
  LoadedDocumentBytes,
} from "../../src/subsystems/persistence/document-store.js";

export const FACT_AUTHORITY_DOCUMENT_ID = "facts";

export function localReceiptsDocumentId(replicaId: string): string {
  return `receipts/${replicaId}`;
}

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
}

export async function documentsContaining(source: DocumentStore, ...ids: readonly string[]): Promise<DocumentStore> {
  const documents = new InMemoryDocumentStore();
  for (const id of ids) {
    const loaded = await source.load(id);
    if (loaded === null) {
      throw new Error(`Document ${id} is absent`);
    }
    if (loaded.snapshot !== null) {
      await documents.writeSnapshot(id, loaded.snapshot);
    }
    if (loaded.updates.length > 0) {
      await documents.appendUpdates(loaded.updates.map((bytes) => ({ id, bytes })));
    }
  }
  return documents;
}
