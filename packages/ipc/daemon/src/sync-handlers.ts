import { create } from "@bufbuild/protobuf";
import { EmptySchema, type Empty } from "@bufbuild/protobuf/wkt";
import type {
  AddMemberRequest,
  JoinWorkspaceRequest,
  RegisterSyncRequest,
  ShareWorkspaceRequest,
  SyncNowRequest,
  WorkspaceCoordinate,
} from "@lode/protocol/proto";
import { WorkspaceCoordinateSchema } from "@lode/protocol/proto";
import type { AppRuntime } from "@lode/engine";
import type { DaemonSyncRunner } from "./sync-runner.js";

const EMPTY: Empty = create(EmptySchema);

/** The daemon-side RPC handlers for sync governance + register/share/join. They reach the
 *  `DaemonSyncRunner` — a host concern, so they live in the daemon, not the engine. The daemon merges
 *  them with the engine's `LodeCommands` in `connect-server.ts`. All are session-gated (writes require
 *  an origin); the actor keypair for register/join/addMember comes from the session (sessionHello),
 *  never re-sent by the client. `addMember` is relay-independent — it writes the membership log
 *  directly (no sync wiring needed); the others go through the runner. */
export type SyncHandlers = {
  addMember: (req: AddMemberRequest, connectionId: string) => Promise<Empty>;
  shareWorkspace: (req: ShareWorkspaceRequest, connectionId: string) => WorkspaceCoordinate;
  joinWorkspace: (req: JoinWorkspaceRequest, connectionId: string) => Promise<Empty>;
  registerSync: (req: RegisterSyncRequest, connectionId: string) => Promise<Empty>;
  syncNow: (req: SyncNowRequest, connectionId: string) => Promise<Empty>;
};

export function createSyncHandlers(
  runner: DaemonSyncRunner,
  workspaces: AppRuntime["workspaces"],
  sessions: AppRuntime["sessions"],
): SyncHandlers {
  return {
    // Register the session's actor to drive sync for a workspace via a relay. The runner captures the
    // keypair so the tick keeps signing after the client disconnects.
    registerSync: async (req, connectionId) => {
      sessions.requireOrigin(connectionId);
      const { keypair } = sessions.getActorKeypair(connectionId);
      await runner.registerSync(req.workspaceId, req.relayUrl, keypair);
      return EMPTY;
    },
    // Manual trigger: run one sync round for the workspace now (`lode sync now`), instead of waiting
    // for the next tick. The actor is the registered one — origin-gated like every sync write.
    syncNow: async (req, connectionId) => {
      sessions.requireOrigin(connectionId);
      await runner.syncNow(req.workspaceId);
      return EMPTY;
    },
    // Owner-only governance: add a member to the workspace's membership log. Relay-independent —
    // it writes the log directly via the registry + the calling session's keypair (the owner), with
    // no sync wiring required. The owner guard lives in `MembershipLog.addMember`.
    addMember: async (req, connectionId) => {
      sessions.requireOrigin(connectionId);
      const { keypair: owner } = sessions.getActorKeypair(connectionId);
      const log = workspaces.membershipLog(req.workspaceId);
      if (!log) {
        throw new Error(`addMember: workspace not loaded: ${req.workspaceId}`);
      }
      log.addMember(owner, req.memberSignPub);
      await log.persistIfDirty();
      return EMPTY;
    },
    shareWorkspace: (req, connectionId) => {
      sessions.requireOrigin(connectionId);
      const c = runner.shareCoordinate(req.workspaceId);
      return create(WorkspaceCoordinateSchema, {
        relayUrl: c.relayUrl,
        workspaceId: c.workspaceId,
      });
    },
    joinWorkspace: async (req, connectionId) => {
      sessions.requireOrigin(connectionId);
      const c = req.coordinate;
      if (!c) {
        throw new Error("joinWorkspace: missing coordinate");
      }
      const { keypair } = sessions.getActorKeypair(connectionId);
      await runner.joinWorkspace(c.workspaceId, c.relayUrl, keypair);
      return EMPTY;
    },
  };
}
