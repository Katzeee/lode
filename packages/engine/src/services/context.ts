import type { Engine } from "../core/index.js";
import { DocNotFoundError } from "./errors.js";
import type { AppWorkspaceRuntime } from "../runtime/workspace-registry.js";
import type { SessionManager } from "../session/session-manager.js";

export type AppContext = {
  workspaces: AppWorkspaceRuntime;
  sessions: SessionManager;
};

export async function getEngine(ctx: AppContext, workspaceId: string): Promise<Engine> {
  const engine = await ctx.workspaces.getEngine(workspaceId);
  if (!engine) {
    throw new DocNotFoundError(workspaceId);
  }
  return engine;
}
