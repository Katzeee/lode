import type { SyncableComposite, SyncableDoc } from "../workspace/index.js";
import type { ReplicaPeer, SyncProfileEntry } from "./sync-exchange.js";

export function createReplicaPeer(replica: SyncableComposite): ReplicaPeer {
  return {
    profile: () =>
      Promise.all(
        replica.docs().map(async (document): Promise<SyncProfileEntry> => ({
          documentId: document.id,
          version: await document.version(),
        })),
      ),
    fetch: async (documentId, from) => await requireSyncDocument(replica, documentId).exportUpdate(from),
    send: async (documentId, bytes) => {
      const document = requireSyncDocument(replica, documentId);
      try {
        await document.importUpdate(bytes);
      } catch (error) {
        try {
          await replica.heal();
        } catch (cleanupError) {
          const failure = new AggregateError(
            [toError(error), toError(cleanupError)],
            "Replica import and healing failed",
            { cause: error },
          );
          throw failure;
        }
        throw error;
      }
      await replica.heal();
    },
  };
}

function requireSyncDocument(replica: SyncableComposite, documentId: string): SyncableDoc {
  const document = replica.docs().find((candidate) => candidate.id === documentId);
  if (document === undefined) {
    throw new Error(`Unknown synchronization document: ${documentId}`);
  }
  return document;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
