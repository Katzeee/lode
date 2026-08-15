import type { Engine } from "@lode/sdk/host";
import { AppRuntime } from "./runtime/kernel/app-runtime.js";
import { WorkspaceSessions } from "./runtime/workspace-sessions/index.js";
import { ProposalWorkspaceRegistry } from "./runtime/workspace/proposal-registry.js";

export type EngineOptions = Readonly<{
  persistence?: Readonly<{ dataRoot: string }>;
}>;

export async function createEngine(options: EngineOptions = {}): Promise<Engine> {
  const runtime = new AppRuntime("engine");
  const registry = new ProposalWorkspaceRegistry();
  const sessions = runtime.root.own(new WorkspaceSessions(registry, options.persistence?.dataRoot));
  await runtime.start();

  let closePromise: Promise<void> | undefined;
  return {
    application: registry.contract,
    workspaces: {
      open: (workspaceId) => sessions.open(workspaceId),
      close: (workspaceId) => sessions.close(workspaceId),
      recoverAuthority: (workspaceId) => sessions.recoverAuthority(workspaceId),
    },
    replicas: {
      synchronize: (workspaceId, peer) => sessions.synchronize(workspaceId, peer),
      peer: (workspaceId) => sessions.peer(workspaceId),
    },
    close: () => (closePromise ??= closeEngine(runtime)),
  };
}

async function closeEngine(runtime: AppRuntime): Promise<void> {
  const report = await runtime.stop();
  if (report.errors.length > 0) {
    throw new AggregateError(report.errors, "Engine failed to close cleanly");
  }
}
