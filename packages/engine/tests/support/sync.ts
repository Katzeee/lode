import type { SyncBytes, SyncableComposite, SyncableDoc } from "../../src/sync/syncable.js";
import { SyncExchange, type ReplicaPeer, type SyncProfileEntry } from "../../src/runtime/sync/sync-exchange.js";

export class InMemoryReplicaPeer implements ReplicaPeer {
  constructor(private readonly remote: SyncableComposite) {}

  profile(): Promise<readonly SyncProfileEntry[]> {
    return Promise.all(
      this.remote.docs().map(async (document) => ({
        documentId: document.id,
        version: await document.version(),
      })),
    );
  }

  async fetch(documentId: string, from: SyncBytes): Promise<SyncBytes> {
    return (await this.document(documentId)?.exportUpdate(from)) ?? new Uint8Array();
  }

  async send(documentId: string, bytes: SyncBytes): Promise<void> {
    await this.document(documentId)?.importUpdate(bytes);
  }

  private document(documentId: string): SyncableDoc | undefined {
    return this.remote.docs().find((document) => document.id === documentId);
  }
}

export async function syncPair(left: SyncableComposite, right: SyncableComposite): Promise<void> {
  await new SyncExchange(left, new InMemoryReplicaPeer(right)).sync();
  await right.heal();
}
