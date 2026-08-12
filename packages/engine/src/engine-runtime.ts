import type { EngineContract } from "./application/contract.js";
import { AppRuntime } from "./runtime/kernel/app-runtime.js";
import type { RuntimeResource } from "./runtime/kernel/resource.js";
import { SerialExecutor } from "./runtime/kernel/serial-executor.js";
import { FactSyncComposite } from "./runtime/sync/fact-sync.js";
import {
  SyncExchange,
  type SyncProfileEntry,
  type SyncTransport,
} from "./runtime/sync/sync-exchange.js";
import { openProposalWorkspace } from "./runtime/workspace/proposal-storage.js";
import { ProposalWorkspaceRegistry } from "./runtime/workspace/proposal-registry.js";

export type PersistenceOptions = Readonly<{ dataRoot: string }>;

export type RuntimeConfig = Readonly<{
  persistence?: PersistenceOptions;
}>;

export type EngineRuntime = Readonly<{
  engine: EngineContract;
  app: AppRuntime;
  openWorkspace(workspaceId: string): Promise<void>;
  closeWorkspace(workspaceId: string): Promise<boolean>;
  recoverWorkspaceAuthority(workspaceId: string): Promise<boolean>;
  syncWorkspace(
    workspaceId: string,
    transport: SyncTransport,
  ): Promise<Readonly<{ pulled: number; pushed: number }>>;
  syncWorkspaceWith(workspaceId: string, peer: EngineRuntime): Promise<void>;
  workspaceSyncTransport(workspaceId: string): SyncTransport;
}>;

export function createEngineRuntime(config: RuntimeConfig = {}): Promise<EngineRuntime> {
  const app = new AppRuntime("engine");
  const registry = new ProposalWorkspaceRegistry();
  const resources = app.root.own(new ProposalWorkspaceResources(registry));
  const lifecycle = new SerialExecutor();
  const runtime: EngineRuntime = {
    engine: registry.contract,
    app,
    openWorkspace: (workspaceId) =>
      lifecycle.run(async () => {
        if (registry.has(workspaceId)) {
          return;
        }
        const opened = await openProposalWorkspace(workspaceId, config.persistence?.dataRoot);
        const sync = new FactSyncComposite(opened.facts, () =>
          opened.workspace.reconcileAuthorityAdvance(),
        );
        registry.register(opened.workspace);
        resources.add(workspaceId, opened.close, opened.recoverAuthority, sync);
      }),
    closeWorkspace: (workspaceId) => lifecycle.run(() => resources.close(workspaceId)),
    recoverWorkspaceAuthority: (workspaceId) =>
      lifecycle.run(() => resources.recoverAuthority(workspaceId)),
    syncWorkspace: (workspaceId, transport) => resources.sync(workspaceId, transport),
    syncWorkspaceWith: async (workspaceId, peer) => {
      await resources.sync(workspaceId, peer.workspaceSyncTransport(workspaceId));
    },
    workspaceSyncTransport: (workspaceId) => resources.transport(workspaceId),
  };
  return Promise.resolve(runtime);
}

class ProposalWorkspaceResources implements RuntimeResource {
  readonly id = "proposal-workspaces";
  private readonly closeByWorkspace = new Map<string, () => Promise<void>>();
  private readonly recoverByWorkspace = new Map<string, () => Promise<void>>();
  private readonly syncByWorkspace = new Map<string, FactSyncComposite>();
  private readonly leases = new Map<string, WorkspaceLease>();

  constructor(private readonly registry: ProposalWorkspaceRegistry) {}

  add(
    workspaceId: string,
    close: () => Promise<void>,
    recoverAuthority: () => Promise<void>,
    sync: FactSyncComposite,
  ): void {
    this.closeByWorkspace.set(workspaceId, close);
    this.recoverByWorkspace.set(workspaceId, recoverAuthority);
    this.syncByWorkspace.set(workspaceId, sync);
    this.leases.set(workspaceId, new WorkspaceLease());
  }

  transport(workspaceId: string): SyncTransport {
    this.syncComposite(workspaceId);
    return {
      profile: () =>
        this.use(workspaceId, async (composite) =>
          Promise.all(
            composite.docs().map(async (doc): Promise<SyncProfileEntry> => ({
              documentId: doc.id,
              version: await doc.version(),
            })),
          ),
        ),
      fetch: (documentId, from) =>
        this.use(
          workspaceId,
          async (composite) =>
            (await composite
              .docs()
              .find((candidate) => candidate.id === documentId)
              ?.exportUpdate(from)) ?? new Uint8Array(),
        ),
      send: (documentId, bytes) =>
        this.use(workspaceId, async (composite) => {
          try {
            await composite
              .docs()
              .find((candidate) => candidate.id === documentId)
              ?.importUpdate(bytes);
          } finally {
            await composite.heal();
          }
        }),
    };
  }

  async sync(
    workspaceId: string,
    transport: SyncTransport,
  ): Promise<Readonly<{ pulled: number; pushed: number }>> {
    return this.use(workspaceId, (composite) => new SyncExchange(composite, transport).sync());
  }

  async recoverAuthority(workspaceId: string): Promise<boolean> {
    const recover = this.recoverByWorkspace.get(workspaceId);
    if (!recover) {
      return false;
    }
    await recover();
    return true;
  }

  async close(workspaceId: string): Promise<boolean> {
    const close = this.closeByWorkspace.get(workspaceId);
    if (!close) {
      return false;
    }
    const lease = this.leases.get(workspaceId);
    lease?.stop();
    this.registry.unregister(workspaceId);
    await lease?.drain();
    this.closeByWorkspace.delete(workspaceId);
    this.recoverByWorkspace.delete(workspaceId);
    this.syncByWorkspace.delete(workspaceId);
    this.leases.delete(workspaceId);
    await close();
    return true;
  }

  async release(): Promise<void> {
    for (const workspaceId of [...this.closeByWorkspace.keys()]) {
      await this.close(workspaceId);
    }
  }

  private syncComposite(workspaceId: string): FactSyncComposite {
    const composite = this.syncByWorkspace.get(workspaceId);
    if (!composite) {
      throw new Error(`Workspace is not loaded for sync: ${workspaceId}`);
    }
    return composite;
  }

  private async use<T>(
    workspaceId: string,
    task: (composite: FactSyncComposite) => Promise<T>,
  ): Promise<T> {
    const composite = this.syncComposite(workspaceId);
    const release = this.leases.get(workspaceId)?.acquire();
    if (!release) {
      throw new Error(`Workspace is closing: ${workspaceId}`);
    }
    try {
      return await task(composite);
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
