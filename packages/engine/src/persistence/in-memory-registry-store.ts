import { randomInt, randomUUID } from "node:crypto";
import { workspaceRelativePath } from "./paths.js";
import type { RegistryStore, WorkspaceRecord } from "./registry-store.js";

/**
 * An in-memory RegistryStore — the ephemeral dual of SqliteRegistryStore. Backs AppWorkspaceRuntime's
 * in-memory mode so the runtime holds a RegistryStore in BOTH modes (no scattered `if (!registry)`):
 * "persistent vs in-memory" is which impl is injected. Workspaces + the peer id / peer key live only
 * for the process lifetime — nothing survives a restart.
 *
 * Methods return `Promise`s (the `RegistryStore` contract is async — the SQLite adapter reads off the
 * main thread) but resolve synchronously: the work is in-memory Map ops. (Same idiom as
 * `InMemoryDocStore`.)
 */
export class InMemoryRegistryStore implements RegistryStore {
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly meta = new Map<string, string>();

  createWorkspace(input: { workspaceId?: string; displayName: string }): Promise<WorkspaceRecord> {
    const workspaceId = input.workspaceId ?? randomUUID();
    // relativePath is unused in-memory (no per-workspace db file) but the record shape requires it.
    const record: WorkspaceRecord = {
      workspaceId,
      displayName: input.displayName,
      relativePath: workspaceRelativePath(workspaceId),
      createdAt: 0,
      updatedAt: 0,
    };
    this.workspaces.set(workspaceId, record);
    return Promise.resolve(record);
  }

  listWorkspaces(): Promise<WorkspaceRecord[]> {
    return Promise.resolve([...this.workspaces.values()]);
  }

  getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    return Promise.resolve(this.workspaces.get(workspaceId) ?? null);
  }

  removeWorkspace(workspaceId: string): Promise<boolean> {
    return Promise.resolve(this.workspaces.delete(workspaceId));
  }

  getMeta(key: string): Promise<string | null> {
    return Promise.resolve(this.meta.get(key) ?? null);
  }

  setMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
    return Promise.resolve();
  }

  /** Get-or-create this runtime's stable peer id — same semantics as SqliteRegistryStore.ensurePeerId,
   *  but held in the in-memory meta map (stable for the process, gone on exit). */
  ensurePeerId(): Promise<number> {
    const existing = this.meta.get("peerId");
    if (existing !== undefined) {
      const parsed = Number(existing);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        return Promise.resolve(parsed);
      }
    }
    const peerId = randomInt(1, 2 ** 48);
    this.meta.set("peerId", String(peerId));
    return Promise.resolve(peerId);
  }

  close(): Promise<void> {
    // Nothing to release — all state is in-memory.
    return Promise.resolve();
  }
}
