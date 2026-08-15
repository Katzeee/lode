import type { SyncBytes, SyncableComposite, SyncableDoc } from "../../sync/syncable.js";
import type { ReplicaPeer } from "@lode/sdk/host";

export type { ReplicaPeer, SyncProfileEntry } from "@lode/sdk/host";

export class SyncExchange {
  private readonly remoteVersions = new Map<string, SyncBytes>();

  constructor(
    private readonly composite: SyncableComposite,
    private readonly transport: ReplicaPeer,
  ) {}

  async sync(): Promise<Readonly<{ pulled: number; pushed: number }>> {
    const remote = new Map((await this.transport.profile()).map((entry) => [entry.documentId, entry.version]));
    this.remoteVersions.clear();
    for (const [id, version] of remote) {
      this.remoteVersions.set(id, version);
    }
    let pulled = 0;
    let pushed = 0;
    try {
      for (const document of this.composite.docs()) {
        const result = await this.exchange(document, remote.get(document.id));
        pulled += result.pulled ? 1 : 0;
        pushed += result.pushed ? 1 : 0;
      }
    } finally {
      await this.composite.heal();
    }
    await this.refreshRemoteVersions();
    return { pulled, pushed };
  }

  async pushOnly(): Promise<Readonly<{ pushed: number }>> {
    if (this.remoteVersions.size === 0) {
      return { pushed: 0 };
    }
    let pushed = 0;
    for (const document of this.composite.pushDocs()) {
      const remoteVersion = this.remoteVersions.get(document.id);
      if (remoteVersion && bytesEqual(await document.version(), remoteVersion)) {
        continue;
      }
      const bytes = await document.exportUpdate(remoteVersion);
      if (bytes.length > 0) {
        await this.transport.send(document.id, bytes);
        pushed += 1;
      }
    }
    await this.refreshRemoteVersions();
    return { pushed };
  }

  private async refreshRemoteVersions(): Promise<void> {
    this.remoteVersions.clear();
    for (const entry of await this.transport.profile()) {
      this.remoteVersions.set(entry.documentId, entry.version);
    }
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
