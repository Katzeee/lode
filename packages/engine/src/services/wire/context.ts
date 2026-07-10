import type { Engine } from "../../core/index.js";
import { DocNotFoundError } from "../../errors.js";
import type { NotificationHub } from "../../event.js";
import type { WorkspaceProvider } from "../../workspace-provider.js";

export type AppContext = {
  /** The workspace-capability surface — a port, so services never imports the runtime impl. */
  workspaces: WorkspaceProvider;
  /** The notification pub/sub half — subscribe/broadcast (a port, same reason). */
  notify: NotificationHub;
};

export async function getEngine(ctx: AppContext, workspaceId: string): Promise<Engine> {
  const engine = await ctx.workspaces.getEngine(workspaceId);
  if (!engine) {
    throw new DocNotFoundError(workspaceId);
  }
  return engine;
}
