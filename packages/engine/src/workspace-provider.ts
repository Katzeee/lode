import type { Engine } from "./core/index.js";
import type { MembershipLog, LocalPeer } from "./runtime/membership/membership-log.js";
import type { CreateWorkspaceInput, ForkWorkspaceInput } from "./runtime/workspace/factory.js";
import type { RuntimeWorkspaceInfo } from "./runtime/workspace/types.js";
import type { ActorKeypair } from "./utils/crypto/index.js";

/**
 * The workspace-capability surface services consume — the workspaces half of AppContext, as a port.
 * Mirrors NotificationHub: services depend on this contract, not the runtime's AppWorkspaceRuntime
 * impl, so `services → runtime` has zero declared imports (only the port + the notify port). The
 * runtime's AppWorkspaceRuntime satisfies it structurally + declares `implements`.
 *
 * (This lives at the src root — not a low-level leaf like event.ts — because its method signatures
 * reference runtime vocabulary: the workspace content/factory types + MembershipLog/LocalPeer. That
 * vocabulary is the contract; the point is services reaches the CONTRACT, never the impl class.)
 */
export type WorkspaceProvider = {
  getEngine(workspaceId: string): Promise<Engine | null>;
  membershipLog(workspaceId: string): MembershipLog | null;
  localPeerFor(actor: ActorKeypair): LocalPeer;
  createWorkspace(input: CreateWorkspaceInput): Promise<RuntimeWorkspaceInfo>;
  forkWorkspace(input: ForkWorkspaceInput): Promise<RuntimeWorkspaceInfo>;
  listWorkspaces(): Promise<RuntimeWorkspaceInfo[]>;
  removeWorkspace(workspaceId: string): Promise<boolean>;
  flushDirty(workspaceId: string): Promise<void>;
  /** Run `work` serialized on the workspace's mutation chain (same-workspace mutations atomic). */
  runWorkspaceSerialized<T>(workspaceId: string, work: () => Promise<T>): Promise<T>;
};
