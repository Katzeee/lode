import type { AppContext } from "./context.js";
import { createFieldDefHandlers } from "./field-def.js";
import { createFieldHandlers } from "./field.js";
import { createHistoryHandlers } from "./history.js";
import { createNodeHandlers } from "./node.js";
import { createRefHandlers } from "./ref.js";
import { createSchemaHandlers } from "./schema.js";
import { createSessionHandlers } from "./session.js";
import { createWorkspaceHandlers } from "./workspace.js";

// Assembles the LodeCommands handler set: an object keyed by camelCase RPC name, each
// handler taking (request, connectionId). Transport-free — the host (daemon, Connect)
// injects connectionId per connection; in-process callers (mobile) pass their own.
export function createLodeCommands(ctx: AppContext) {
  return {
    ...createSessionHandlers(ctx),
    ...createWorkspaceHandlers(ctx),
    ...createNodeHandlers(ctx),
    ...createRefHandlers(ctx),
    ...createSchemaHandlers(ctx),
    ...createFieldDefHandlers(ctx),
    ...createFieldHandlers(ctx),
    ...createHistoryHandlers(ctx),
  };
}

export type { AppContext };
