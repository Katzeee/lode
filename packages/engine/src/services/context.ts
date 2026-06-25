import type { Engine } from "../core/index.js";
import { DocNotFoundError } from "./errors.js";
import type { AppWorkspaceRuntime } from "../persistence/runtime.js";
import type { SessionManager } from "./session-manager.js";

export type AppContext = {
  workspaces: AppWorkspaceRuntime;
  sessions: SessionManager;
};

export async function getDoc(ctx: AppContext, workspaceId: string, docId: string): Promise<Engine> {
  const doc = await ctx.workspaces.getDoc(workspaceId, docId);
  if (!doc) {
    throw new DocNotFoundError(docId);
  }
  return doc;
}
