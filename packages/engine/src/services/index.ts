import type { AppContext } from "./wire/context.js";
import { createEditingHandlers } from "./editing.js";
import { createFieldDefHandlers } from "./field-def.js";
import { createFieldHandlers } from "./field.js";
import { createHistoryHandlers } from "./history.js";
import { createMembershipHandlers } from "./membership.js";
import { createNodeHandlers } from "./node.js";
import { createRefHandlers } from "./ref.js";
import { createSchemaHandlers } from "./schema.js";
import { createWorkspaceHandlers } from "./workspace.js";

// Assembles the DOMAIN handler set: an object keyed by camelCase RPC name, each handler taking
// (request, caller, connectionId). The session/notification/identity RPCs are NOT here — they live
// in runtime/session-rpcs (they reach the identity store + notification hub directly); the
// composition root merges them + auth-wraps the lot (wrapCommands).
export function createLodeCommands(ctx: AppContext) {
  return {
    ...createWorkspaceHandlers(ctx),
    ...createMembershipHandlers(ctx),
    ...createNodeHandlers(ctx),
    ...createEditingHandlers(ctx),
    ...createRefHandlers(ctx),
    ...createSchemaHandlers(ctx),
    ...createFieldDefHandlers(ctx),
    ...createFieldHandlers(ctx),
    ...createHistoryHandlers(ctx),
  };
}

export type { AppContext };
