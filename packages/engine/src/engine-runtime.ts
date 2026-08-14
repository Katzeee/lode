import type { EngineContract } from "./application/contract.js";
import { AppRuntime } from "./runtime/kernel/app-runtime.js";
import type { SyncTransport } from "./runtime/sync/sync-exchange.js";
import { ProposalWorkspaceHost } from "./runtime/workspace-host/index.js";
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
  const host = app.root.own(new ProposalWorkspaceHost(registry, config.persistence?.dataRoot));
  const runtime: EngineRuntime = {
    engine: registry.contract,
    app,
    openWorkspace: (workspaceId) => host.open(workspaceId),
    closeWorkspace: (workspaceId) => host.close(workspaceId),
    recoverWorkspaceAuthority: (workspaceId) => host.recoverAuthority(workspaceId),
    syncWorkspace: (workspaceId, transport) => host.sync(workspaceId, transport),
    syncWorkspaceWith: async (workspaceId, peer) => {
      await host.sync(workspaceId, peer.workspaceSyncTransport(workspaceId));
    },
    workspaceSyncTransport: (workspaceId) => host.transport(workspaceId),
  };
  return Promise.resolve(runtime);
}
