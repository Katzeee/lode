import { create } from "@bufbuild/protobuf";
import { EmptySchema, type Empty } from "@bufbuild/protobuf/wkt";
import type {
  AddMemberRequest,
  JoinWorkspaceRequest,
  ShareWorkspaceRequest,
  WorkspaceCoordinate,
} from "@lode/protocol/proto";
import { WorkspaceCoordinateSchema } from "@lode/protocol/proto";
import type { AppRuntime } from "@lode/engine";
import type { DaemonSyncRunner } from "./sync-runner.js";

const EMPTY: Empty = create(EmptySchema);

/** The daemon-side RPC handlers for sync governance + share/join. They reach the `DaemonSyncRunner`
 *  (which owns the live membership log + the owner keypair) — a host concern, so they live in the
 *  daemon, not the engine. The daemon merges them with the engine's `LodeCommands` in
 *  `connect-server.ts`. All three are session-gated (writes require an origin, matching the engine's
 *  gate; `getActorPublicKeys` lives engine-side and self-gates). */
export type SyncHandlers = {
  addMember: (req: AddMemberRequest, connectionId: string) => Promise<Empty>;
  shareWorkspace: (
    req: ShareWorkspaceRequest,
    connectionId: string,
  ) => Promise<WorkspaceCoordinate>;
  joinWorkspace: (req: JoinWorkspaceRequest, connectionId: string) => Promise<Empty>;
};

export function createSyncHandlers(
  runner: DaemonSyncRunner | undefined,
  sessions: AppRuntime["sessions"],
): SyncHandlers {
  // A daemon without `--actor-mnemonic` has no sync runner; the sync RPCs are present (the service
  // descriptor requires them) but throw — sync needs an actor identity.
  const requireRunner = (): DaemonSyncRunner => {
    if (!runner) {
      throw new Error("sync not configured (start the daemon with --actor-mnemonic)");
    }
    return runner;
  };
  return {
    addMember: async (req, connectionId) => {
      sessions.requireOrigin(connectionId);
      await requireRunner().addMember(req.workspaceId, req.memberSignPub);
      return EMPTY;
    },
    shareWorkspace: async (req, connectionId) => {
      sessions.requireOrigin(connectionId);
      const c = await requireRunner().shareCoordinate(req.workspaceId);
      return create(WorkspaceCoordinateSchema, {
        relayUrl: c.relayUrl,
        workspaceId: c.workspaceId,
        docId: c.docId,
      });
    },
    joinWorkspace: async (req, connectionId) => {
      sessions.requireOrigin(connectionId);
      const c = req.coordinate;
      if (!c) {
        throw new Error("joinWorkspace: missing coordinate");
      }
      await requireRunner().joinWorkspace(c.workspaceId, c.relayUrl, c.docId);
      return EMPTY;
    },
  };
}
