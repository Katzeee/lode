import type { SyncBytes, SyncableComposite, SyncableDoc } from "../workspace/index.js";

export type SyncProfileEntry = Readonly<{ documentId: string; version: Uint8Array }>;

export type ReplicaPeer = Readonly<{
  profile(): Promise<readonly SyncProfileEntry[]>;
  fetch(documentId: string, from: Uint8Array): Promise<Uint8Array>;
  send(documentId: string, bytes: Uint8Array): Promise<void>;
}>;

export class SyncExchange {
  constructor(
    private readonly composite: SyncableComposite,
    private readonly transport: ReplicaPeer,
  ) {}

  async sync(): Promise<Readonly<{ pulled: number; pushed: number }>> {
    const remote = new Map((await this.transport.profile()).map((entry) => [entry.documentId, entry.version]));
    let pulled = 0;
    let pushed = 0;
    try {
      for (const document of this.composite.docs()) {
        const result = await this.exchange(document, remote.get(document.id));
        pulled += result.pulled ? 1 : 0;
        pushed += result.pushed ? 1 : 0;
      }
    } catch (error) {
      try {
        await this.composite.heal();
      } catch (cleanupError) {
        const failure = new AggregateError(
          [toError(error), toError(cleanupError)],
          "Replica exchange and healing failed",
          {
            cause: error,
          },
        );
        throw failure;
      }
      throw error;
    }
    await this.composite.heal();
    return { pulled, pushed };
  }

  private async exchange(
    document: SyncableDoc,
    remoteVersion: SyncBytes | undefined,
  ): Promise<Readonly<{ pulled: boolean; pushed: boolean }>> {
    const localVersion = await document.version();
    if (remoteVersion && bytesEqual(localVersion, remoteVersion)) {
      return { pulled: false, pushed: false };
    }
    const pull = remoteVersion ? await this.transport.fetch(document.id, localVersion) : new Uint8Array();
    const push = await document.exportUpdate(remoteVersion);
    if (pull.length > 0) {
      await document.importUpdate(pull);
    }
    if (push.length > 0) {
      await this.transport.send(document.id, push);
    }
    return { pulled: pull.length > 0, pushed: push.length > 0 };
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
