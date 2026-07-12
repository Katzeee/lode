import type { Engine } from "../../core/index.js";
import type { WorkspaceRegistry } from "../../runtime/workspace/registry.js";
import type { SyncService } from "../../runtime/sync/sync-service.js";

export type CommandDeps = {
  /** The workspace registry — a command handler's job is to orchestrate domain + runtime, so it
   *  reaches the registry directly. No port indirection: the registry is the single implementation. */
  workspaces: WorkspaceRegistry;
  /** The sync coordinator — for the relay-lifecycle RPCs (share/join/register/syncNow). */
  sync: SyncService;
};

export function readWorkspace<T>(
  ctx: CommandDeps,
  workspaceId: string,
  operation: (engine: Engine) => T | Promise<T>,
): Promise<T> {
  return ctx.workspaces.runWorkspace(workspaceId, ({ engine }) => operation(engine));
}
