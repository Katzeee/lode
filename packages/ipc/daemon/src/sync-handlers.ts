import { create } from "@bufbuild/protobuf";
import type { Empty } from "@bufbuild/protobuf/wkt";
import type {
  JoinWorkspaceRequest,
  RegisterSyncRequest,
  ShareWorkspaceRequest,
  SyncNowRequest,
  WorkspaceCoordinate,
} from "@lode/protocol/proto";
import { WorkspaceCoordinateSchema } from "@lode/protocol/proto";
import { EMPTY, type AppRuntime } from "@lode/engine";

/** The daemon-side RPC handlers for relay-connection lifecycle (share/join/register/syncNow). They
 *  are thin, session-gated forwards to the engine-owned `SyncRegistry` (`AppRuntime.sync`) —
 *  the sync composition (transport + round driver + push path + lazy-wire poll) lives in the engine
 *  now, so an in-process host (mobile/embedded) gets the same surface with no daemon. The daemon
 *  adds only the connectionId-aware session gate (the engine never sees connectionIds); the actor
 *  keypair comes from the session (sessionHello), never re-sent by the client. Relay-independent
 *  governance (addMember/list/revoke/addPeer/transfer/rotate/getPeerPublicKeys) is in the engine's
 *  own handlers, merged with these in `connect-server.ts`. */
export type SyncHandlers = {
  shareWorkspace: (req: ShareWorkspaceRequest, connectionId: string) => WorkspaceCoordinate;
  joinWorkspace: (req: JoinWorkspaceRequest, connectionId: string) => Promise<Empty>;
  registerSync: (req: RegisterSyncRequest, connectionId: string) => Promise<Empty>;
  syncNow: (req: SyncNowRequest, connectionId: string) => Promise<Empty>;
};

export function createSyncHandlers(
  registry: AppRuntime["sync"],
  identity: AppRuntime["identity"],
): SyncHandlers {
  return {
    // Register the session's actor to drive sync for a workspace via a relay. The registry captures
    // the keypair so rounds keep signing after the client disconnects.
    registerSync: async (req, connectionId) => {
      identity.requireOrigin(connectionId);
      const { keypair } = identity.getActorKeypair(connectionId);
      await registry.registerSync(req.workspaceId, req.relayUrl, keypair);
      return EMPTY;
    },
    // Manual trigger: run one sync round for the workspace now (`lode sync now`).
    syncNow: async (req, connectionId) => {
      identity.requireOrigin(connectionId);
      await registry.syncNow(req.workspaceId);
      return EMPTY;
    },
    // Surface the relay URL this daemon registered + the wsId as a share coordinate (host→client: the
    // CLI talks to the daemon IPC, not the relay, so it doesn't know the relay absent this).
    shareWorkspace: (req, connectionId) => {
      identity.requireOrigin(connectionId);
      const c = registry.shareCoordinate(req.workspaceId);
      return create(WorkspaceCoordinateSchema, {
        relayUrl: c.relayUrl,
        workspaceId: c.workspaceId,
      });
    },
    // Join a workspace via a share coordinate: ensure it exists locally, register, directed-fetch the
    // membership roster, and auto-fire a content round.
    joinWorkspace: async (req, connectionId) => {
      identity.requireOrigin(connectionId);
      const c = req.coordinate;
      if (!c) {
        throw new Error("joinWorkspace: missing coordinate");
      }
      const { keypair } = identity.getActorKeypair(connectionId);
      await registry.joinWorkspace(c.workspaceId, c.relayUrl, keypair);
      return EMPTY;
    },
  };
}
