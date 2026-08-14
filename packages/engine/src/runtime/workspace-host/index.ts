import type { RuntimeResource } from "../kernel/resource.js";
import { SerialExecutor } from "../kernel/serial-executor.js";
import { FactSyncComposite } from "../sync/fact-sync.js";
import { SyncExchange, type SyncProfileEntry, type SyncTransport } from "../sync/sync-exchange.js";
import { openProposalWorkspace } from "../workspace/proposal-storage.js";
import type { ProposalWorkspaceRegistry } from "../workspace/proposal-registry.js";

type HostedProposalWorkspace = Readonly<{
  close(): Promise<void>;
  recoverAuthority(): Promise<void>;
  sync: FactSyncComposite;
  lease: WorkspaceLease;
}>;

export class ProposalWorkspaceHost implements RuntimeResource {
  readonly id = "proposal-workspaces";
  private readonly workspaces = new Map<string, HostedProposalWorkspace>();
  private readonly lifecycle = new SerialExecutor();

  constructor(
    private readonly registry: ProposalWorkspaceRegistry,
    private readonly dataRoot?: string,
  ) {}

  open(workspaceId: string): Promise<void> {
    return this.lifecycle.run(async () => {
      if (this.workspaces.has(workspaceId)) {
        return;
      }
      const opened = await openProposalWorkspace(workspaceId, this.dataRoot);
      const hosted = {
        close: opened.close,
        recoverAuthority: opened.recoverAuthority,
        sync: new FactSyncComposite(opened.factReplica, () =>
          opened.workspace.reconcileAuthorityAdvance(),
        ),
        lease: new WorkspaceLease(),
      };
      this.registry.register(opened.workspace);
      this.workspaces.set(workspaceId, hosted);
    });
  }

  close(workspaceId: string): Promise<boolean> {
    return this.lifecycle.run(() => this.closeExclusive(workspaceId));
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

  sync(
    workspaceId: string,
    transport: SyncTransport,
  ): Promise<Readonly<{ pulled: number; pushed: number }>> {
    return this.use(workspaceId, (workspace) => new SyncExchange(workspace.sync, transport).sync());
  }

  transport(workspaceId: string): SyncTransport {
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
      throw new Error(`Workspace is not loaded for sync: ${workspaceId}`);
    }
    return workspace;
  }

  private async use<T>(
    workspaceId: string,
    task: (workspace: HostedProposalWorkspace) => Promise<T>,
  ): Promise<T> {
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
    return this.active === 0
      ? Promise.resolve()
      : new Promise((resolve) => this.drained.push(resolve));
  }
}
