import type { RuntimeResource } from "../kernel/resource.js";
import { SerialExecutor } from "../kernel/serial-executor.js";
import { FactSyncComposite } from "../sync/fact-sync.js";
import { SyncExchange, type ReplicaPeer, type SyncProfileEntry } from "../sync/sync-exchange.js";
import { WorkspaceNotFoundError } from "@lode/sdk/host";
import { openProposalWorkspace } from "../workspace/proposal-storage.js";
import type { ProposalWorkspaceRegistry } from "../workspace/proposal-registry.js";
import { WorkspaceCatalog, workspaceCatalogFile, type WorkspaceCatalogEntry } from "./workspace-catalog.js";

type HostedProposalWorkspace = Readonly<{
  close(): Promise<void>;
  recoverAuthority(): Promise<void>;
  sync: FactSyncComposite;
  faulted(): boolean;
  lease: WorkspaceLease;
}>;

export class WorkspaceSessions implements RuntimeResource {
  readonly id = "proposal-workspaces";
  private readonly workspaces = new Map<string, HostedProposalWorkspace>();
  private readonly catalogedIds = new Set<string>();
  private readonly lifecycle = new SerialExecutor();
  private readonly catalog: WorkspaceCatalog;

  constructor(
    private readonly registry: ProposalWorkspaceRegistry,
    private readonly dataRoot?: string,
  ) {
    this.catalog = new WorkspaceCatalog(dataRoot === undefined ? undefined : workspaceCatalogFile(dataRoot));
  }

  /** Boots every cataloged workspace session; call once at host creation. */
  startAll(): Promise<void> {
    return this.lifecycle.run(async () => {
      // ponytail: sequential boot; load in parallel if startup latency matters.
      for (const entry of await this.catalog.list()) {
        this.catalogedIds.add(entry.workspaceId);
        await this.loadExclusive(entry.workspaceId);
      }
    });
  }

  /** Loads one workspace session; the caller (engine composition) owns the
   * create-only invariant that only cataloged or explicitly created ids load. */
  load(workspaceId: string): Promise<void> {
    return this.lifecycle.run(() => this.loadExclusive(workspaceId));
  }

  /** Rolls a session back out of the host; createWorkspace error path only. */
  discard(workspaceId: string): Promise<boolean> {
    return this.lifecycle.run(() => this.closeExclusive(workspaceId));
  }

  async catalogEntries(): Promise<readonly WorkspaceCatalogEntry[]> {
    return this.catalog.list();
  }

  isCataloged(workspaceId: string): boolean {
    return this.catalogedIds.has(workspaceId);
  }

  async record(workspaceId: string, label: string): Promise<void> {
    this.catalogedIds.add(workspaceId);
    await this.catalog.record(workspaceId, label);
  }

  state(workspaceId: string): "active" | "authority-fault" {
    return this.workspaces.get(workspaceId)?.faulted() ? "authority-fault" : "active";
  }

  recoverAuthority(workspaceId: string): Promise<boolean> {
    return this.lifecycle.run(async () => {
      const workspace = this.workspaces.get(workspaceId);
      if (!workspace) {
        return false;
      }
      await workspace.recoverAuthority();
      return true;
    });
  }

  async synchronize(workspaceId: string, peer: ReplicaPeer): Promise<Readonly<{ pulled: number; pushed: number }>> {
    this.assertCataloged(workspaceId);
    return this.use(workspaceId, (workspace) => new SyncExchange(workspace.sync, peer).sync());
  }

  peer(workspaceId: string): ReplicaPeer {
    this.assertCataloged(workspaceId);
    this.workspace(workspaceId);
    return {
      profile: () =>
        this.use(workspaceId, async ({ sync }) =>
          Promise.all(
            sync.docs().map(async (document): Promise<SyncProfileEntry> => ({
              documentId: document.id,
              version: await document.version(),
            })),
          ),
        ),
      fetch: (documentId, from) =>
        this.use(
          workspaceId,
          async ({ sync }) =>
            (await sync
              .docs()
              .find((candidate) => candidate.id === documentId)
              ?.exportUpdate(from)) ?? new Uint8Array(),
        ),
      send: (documentId, bytes) =>
        this.use(workspaceId, async ({ sync }) => {
          try {
            await sync
              .docs()
              .find((candidate) => candidate.id === documentId)
              ?.importUpdate(bytes);
          } finally {
            await sync.heal();
          }
        }),
    };
  }

  release(): Promise<void> {
    return this.lifecycle.run(async () => {
      for (const workspaceId of [...this.workspaces.keys()]) {
        await this.closeExclusive(workspaceId);
      }
    });
  }

  private assertCataloged(workspaceId: string): void {
    if (!this.catalogedIds.has(workspaceId)) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
  }

  private async loadExclusive(workspaceId: string): Promise<void> {
    if (this.workspaces.has(workspaceId)) {
      return;
    }
    const opened = await openProposalWorkspace(workspaceId, this.dataRoot);
    const hosted = {
      close: opened.close,
      recoverAuthority: opened.recoverAuthority,
      sync: new FactSyncComposite(opened.factReplica, () => opened.workspace.reconcileAuthorityAdvance()),
      faulted: () => opened.workspace.authorityFaulted,
      lease: new WorkspaceLease(),
    };
    this.registry.register(opened.workspace);
    this.workspaces.set(workspaceId, hosted);
  }

  private async closeExclusive(workspaceId: string): Promise<boolean> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      return false;
    }
    workspace.lease.stop();
    this.registry.unregister(workspaceId);
    await workspace.lease.drain();
    this.workspaces.delete(workspaceId);
    await workspace.close();
    return true;
  }

  private workspace(workspaceId: string): HostedProposalWorkspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    return workspace;
  }

  private async use<T>(workspaceId: string, task: (workspace: HostedProposalWorkspace) => Promise<T>): Promise<T> {
    const workspace = this.workspace(workspaceId);
    const release = workspace.lease.acquire();
    if (!release) {
      throw new Error(`Workspace is closing: ${workspaceId}`);
    }
    try {
      return await task(workspace);
    } finally {
      release();
    }
  }
}

class WorkspaceLease {
  private active = 0;
  private closing = false;
  private readonly drained: (() => void)[] = [];

  acquire(): (() => void) | null {
    if (this.closing) {
      return null;
    }
    this.active += 1;
    return () => {
      this.active -= 1;
      if (this.active === 0) {
        for (const resolve of this.drained.splice(0)) {
          resolve();
        }
      }
    };
  }

  stop(): void {
    this.closing = true;
  }

  drain(): Promise<void> {
    return this.active === 0 ? Promise.resolve() : new Promise((resolve) => this.drained.push(resolve));
  }
}
