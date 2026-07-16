import type { CommandDeps } from "./wire/context.js";
import type { SessionRpcs } from "./session-rpcs.js";
import type { VaultRpcs } from "./vault-rpcs.js";
import type { WrappedCommands } from "./wrap-commands.js";
import { createEditingHandlers } from "./editing.js";
import { createFieldDefHandlers } from "./field-def.js";
import { createFieldHandlers } from "./field.js";
import { createHistoryHandlers } from "./history.js";
import { createMembershipHandlers } from "./membership.js";
import { createNodeHandlers } from "./node.js";
import { createRefHandlers } from "./ref.js";
import { createSchemaHandlers } from "./schema.js";
import { createSyncHandlers } from "./sync.js";
import { createWorkspaceHandlers } from "./workspace.js";

// Assembles the DOMAIN handler set: an object keyed by camelCase RPC name, each handler taking
// (request, caller, connectionId). The session/notification/identity RPCs (session-rpcs) and the
// vault RPCs (vault-rpcs) are NOT here — they reach the identity store + notification manager + vault
// directly; the composition root merges them + auth-wraps the lot (wrapCommands).
export function createCommands(ctx: CommandDeps) {
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
    ...createSyncHandlers(ctx),
  };
}

/** The command bag transports invoke: each RPC `(req, connectionId) => result`, the caller resolved
 *  at this seam (the auth chokepoint — see wrapCommands). Covers the domain commands + the session
 *  RPCs + the vault RPCs. (The proto `LodeCommands` service descriptor is a separate thing —
 *  `@lode/protocol/proto`.) */
export type Commands = WrappedCommands<ReturnType<typeof createCommands> & SessionRpcs & VaultRpcs>;

export type { CommandDeps };
