import type { Lifecycle } from "../lifecycle.js";
import type { DocStore, Workspace } from "../../core/index.js";
import type { WorkspaceStore } from "../../persistence/workspace-store.js";
import type { MembershipLog } from "../membership/membership-log.js";

/** The user-facing workspace identity (no internal handles). */
export type RuntimeWorkspaceInfo = {
  workspaceId: string;
  displayName: string;
};

/** A loaded workspace's runtime handles: its ChildApp (lifecycle), the Workspace + store + DocStore
 *  port, and the membership log. Shared between the WorkspaceRegistry facade and its
 *  WorkspaceFactory collaborator. */
export type LoadedWorkspace = {
  // Per-workspace sub-runtime: a ChildApp whose components (workspace + store) are stopped in
  // reverse on unload, and which is the mounting point for per-workspace subsystems (sync state).
  app: Lifecycle;
  workspace: Workspace;
  // Null in in-memory mode (no per-workspace SQLite db); a WorkspaceStore in persistent mode.
  store: WorkspaceStore | null;
  // The DocStore port (core's id→bytes contract) the runtime adapts the persistence leaf into.
  // Always present: a WorkspaceDocStore (persistent) or an InMemoryDocStore (in-memory). Content
  // flush + membership persistence both route through it.
  docStore: DocStore;
  // The membership log is workspace state — owned by the engine, consumed by the sync runner via
  // membershipLog(). Created + loaded in mount(); rooted at createWorkspace for an owner.
  membershipLog: MembershipLog;
};
