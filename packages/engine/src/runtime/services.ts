import type { WorkspaceRegistry } from "./workspace/registry.js";
import type { ClientSessionManager } from "./session/client-session-manager.js";
import type { SyncService } from "./sync/sync-service.js";
import type { VaultRuntime } from "./identity/vault.js";

/**
 * The engine runtime's service manifest — module name → service type. Modules are declared against
 * this (their `requires` keys into it; their `deps` is a `Pick` of it), so the dependency graph is
 * visible and type-checked in one place. Add a service: add a module + an entry here.
 */
export type EngineServices = {
  workspaces: WorkspaceRegistry;
  vault: VaultRuntime;
  sessions: ClientSessionManager;
  sync: SyncService;
};
