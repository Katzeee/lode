import { create } from "@bufbuild/protobuf";
import { EmptySchema, type Empty } from "@bufbuild/protobuf/wkt";
import type {
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

/** The daemon-side RPC handlers that genuinely need the `DaemonSyncRunner` — i.e. relay-connection
 *  lifecycle. They live in the daemon (the desktop host), not the engine, because the runner is a
 *  host concern. The daemon merges them with the engine's `LodeCommands` (which now carries the
 *  relay-independent governance handlers via `services/membership.ts`) in `connect-server.ts`.
 *  All are session-gated (writes require an origin); the actor keypair comes from the session
 *  (sessionHello), never re-sent by the client.
 *
 *  Why these four stay daemon-side: register/syncNow drive the runner's tick loop; join dials a
 *  relay through the runner; share returns the daemon's OWN registered relay URL (a host→client
 *  convenience — an in-process consumer like mobile already knows its relay). Governance
 *  (addMember/list/revoke/addPeer/transfer/rotate/getPeerPublicKeys) is relay-independent and was
 *  moved to the engine so mobile gets it too. */
export type SyncHandlers = {
  shareWorkspace: (req: ShareWorkspaceRequest, connectionId: string) => WorkspaceCoordinate;
  joinWorkspace: (req: JoinWorkspaceRequest, connectionId: string) => Promise<Empty>;
  registerSync: (req: RegisterSyncRequest, connectionId: string) => Promise<Empty>;
  syncNow: (req: SyncNowRequest, connectionId: string) => Promise<Empty>;
};

export function createSyncHandlers(
  runner: DaemonSyncRunner,
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
    // Surface THIS daemon's registered relay URL + wsId as a share coordinate (host→client: the CLI
    // talks to the daemon IPC, not the relay, so it doesn't know the relay absent this). Reads the
    // URL the runner captured at registration.
    shareWorkspace: (req, connectionId) => {
      sessions.requireOrigin(connectionId);
      const c = runner.shareCoordinate(req.workspaceId);
      return create(WorkspaceCoordinateSchema, {
        relayUrl: c.relayUrl,
        workspaceId: c.workspaceId,
      });
    },
    // Join a workspace via a share coordinate: dial the relay through the runner and start syncing.
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
