import type { Engine } from "../../core/index.js";
import { DocNotFoundError } from "../../errors/index.js";
import type { WorkspaceRegistry } from "../../runtime/workspace/registry.js";
import type { NotificationManager } from "../../runtime/notification/notification-manager.js";
import type { SyncRegistry } from "../../runtime/sync/registry.js";

export type CommandDeps = {
  /** The workspace registry — a command handler's job is to orchestrate domain + runtime, so it
   *  reaches the registry directly. No port indirection: the registry is the single implementation. */
  workspaces: WorkspaceRegistry;
  /** The notification pub/sub half — subscribe/broadcast. */
  notify: NotificationManager;
  /** The sync coordinator — for the relay-lifecycle RPCs (share/join/register/syncNow). */
  sync: SyncRegistry;
};

export async function getEngine(ctx: CommandDeps, workspaceId: string): Promise<Engine> {
  const engine = await ctx.workspaces.getEngine(workspaceId);
  if (!engine) {
    throw new DocNotFoundError(workspaceId);
  }
  return engine;
}
