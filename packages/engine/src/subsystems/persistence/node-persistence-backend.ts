import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  PersistenceBackend,
  PhysicalIdentityStorage,
  PhysicalWorkspaceStorage,
  PhysicalWorkspaceStorageStage,
} from "./backend.js";
import { FileBlobStore } from "./file-blob-store.js";
import { SqliteWorkspaceStore } from "./sqlite-workspace-store.js";
import { SqliteDocumentStore } from "./sqlite-document-store.js";

const FINAL_PREFIX = "workspace-";
const STAGING_PREFIX = ".staging-";
const SQLITE_SUFFIX = ".sqlite";

export class NodePersistenceBackend implements PersistenceBackend {
  private readonly staged = new Set<string>();
  private closed = false;

  constructor(private readonly dataRoot: string) {}

  openIdentityStorage(): Promise<PhysicalIdentityStorage> {
    this.assertOpen();
    const identityRoot = join(this.dataRoot, "identity");
    return Promise.resolve({
      vault: new FileBlobStore(join(identityRoot, "vault.json")),
      peerIdentity: new FileBlobStore(join(identityRoot, "peer.json")),
    });
  }

  async listWorkspaceIds(): Promise<readonly string[]> {
    this.assertOpen();
    const names = await directoryEntries(this.workspaceDirectory());
    return names.flatMap(decodeWorkspaceFile).sort();
  }

  async openWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorage> {
    this.assertOpen();
    const file = this.finalFile(workspaceId);
    if (!(await exists(file))) {
      throw new Error(`Workspace storage does not exist: ${workspaceId}`);
    }
    return this.openPhysical(workspaceId, file);
  }

  async stageWorkspace(workspaceId: string): Promise<PhysicalWorkspaceStorageStage> {
    this.assertOpen();
    if ((await exists(this.finalFile(workspaceId))) || this.staged.has(workspaceId)) {
      throw new Error(`Workspace storage already exists: ${workspaceId}`);
    }
    await mkdir(this.workspaceDirectory(), { recursive: true });
    const stageId = randomUUID();
    const stagedFile = this.stagingFile(stageId);
    const final = this.finalFile(workspaceId);
    const opened = await this.openPhysical(workspaceId, stagedFile);
    let closeTask: Promise<void> | undefined;
    const close = (): Promise<void> => (closeTask ??= Promise.resolve().then(() => opened.close()));
    const storage = { ...opened, close };
    let active = true;
    this.staged.add(workspaceId);
    return {
      storage,
      promote: async () => {
        this.assertOpen();
        if (!active) {
          throw new Error(`Workspace storage stage is no longer active: ${workspaceId}`);
        }
        if (await exists(final)) {
          throw new Error(`Workspace storage already exists: ${workspaceId}`);
        }
        await close();
        await this.removeSidecars(stagedFile);
        await rename(stagedFile, final);
        let opened: PhysicalWorkspaceStorage;
        try {
          opened = await this.openPhysical(workspaceId, final);
        } catch (error) {
          return failAfterCleanup(error, () => this.removeSqliteFiles(final), "Workspace promotion cleanup failed");
        }
        let closeTask: Promise<void> | undefined;
        const promotedStorage = {
          ...opened,
          close: (): Promise<void> => (closeTask ??= Promise.resolve().then(() => opened.close())),
        };
        let rollbackTask: Promise<void> | undefined;
        active = false;
        this.staged.delete(workspaceId);
        return {
          storage: promotedStorage,
          rollback: (): Promise<void> =>
            (rollbackTask ??= promotedStorage.close().then(() => this.removeSqliteFiles(final))),
        };
      },
      discard: async () => {
        this.assertOpen();
        if (!active) {
          return;
        }
        await close();
        await this.removeSqliteFiles(stagedFile);
        active = false;
        this.staged.delete(workspaceId);
      },
    };
  }

  async discardStagedWorkspaces(): Promise<void> {
    this.assertOpen();
    const directory = this.workspaceDirectory();
    const failures: Error[] = [];
    for (const name of (await directoryEntries(directory)).sort()) {
      if (name.startsWith(STAGING_PREFIX) && name.endsWith(SQLITE_SUFFIX)) {
        try {
          await this.removeSqliteFiles(join(directory, name));
        } catch (error) {
          failures.push(toError(error));
        }
      }
    }
    this.staged.clear();
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, "Staged Workspace cleanup failed");
    }
  }

  close(): void {
    this.closed = true;
  }

  private async openPhysical(workspaceId: string, file: string): Promise<PhysicalWorkspaceStorage> {
    const store = await SqliteWorkspaceStore.open(file);
    return { workspaceId, documents: new SqliteDocumentStore(store), close: () => store.close() };
  }

  private workspaceDirectory(): string {
    return join(this.dataRoot, "workspaces");
  }

  private finalFile(workspaceId: string): string {
    const encoded = Buffer.from(workspaceId, "utf8").toString("base64url");
    return join(this.workspaceDirectory(), `${FINAL_PREFIX}${encoded}${SQLITE_SUFFIX}`);
  }

  private stagingFile(stageId: string): string {
    return join(this.workspaceDirectory(), `${STAGING_PREFIX}${stageId}${SQLITE_SUFFIX}`);
  }

  private async removeSqliteFiles(file: string): Promise<void> {
    await Promise.all([file, `${file}-wal`, `${file}-shm`].map(async (candidate) => rm(candidate, { force: true })));
  }

  private async removeSidecars(file: string): Promise<void> {
    await Promise.all([`${file}-wal`, `${file}-shm`].map(async (candidate) => rm(candidate, { force: true })));
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Persistence backend is closed");
    }
  }
}

function decodeWorkspaceFile(name: string): readonly string[] {
  if (!name.startsWith(FINAL_PREFIX) || !name.endsWith(SQLITE_SUFFIX)) {
    return [];
  }
  const encoded = name.slice(FINAL_PREFIX.length, -SQLITE_SUFFIX.length);
  const workspaceId = Buffer.from(encoded, "base64url").toString("utf8");
  if (workspaceId.length === 0 || Buffer.from(workspaceId, "utf8").toString("base64url") !== encoded) {
    throw new Error(`Workspace storage filename contains a corrupt identity: ${name}`);
  }
  return [workspaceId];
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function directoryEntries(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === code;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function failAfterCleanup(primary: unknown, cleanup: () => Promise<void>, message: string): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    const failure = new AggregateError([toError(primary), toError(cleanupError)], message, { cause: primary });
    throw failure;
  }
  throw primary;
}
