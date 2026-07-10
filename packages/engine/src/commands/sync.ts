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
import { authed } from "./handler.js";
import { EMPTY } from "./wire/empty.js";
import type { CommandDeps } from "./wire/context.js";

/** Relay-lifecycle sync RPCs (share/join/register/syncNow). They depend on the engine-resident
 *  SyncRegistry (ctx.sync) — the relay connection + round driver live in the engine, so an in-process
 *  host (mobile/embedded) gets them with no daemon. Each is `authed`: the boundary resolves the caller
 *  and the actor keypair comes from `caller.keypair` (captured at hello), never re-sent by the client.
 *  Relay-independent governance (addMember/list/revoke/addPeer/transfer/rotate/getPeerPublicKeys) is
 *  in membership.ts. */
export function createSyncHandlers(ctx: CommandDeps) {
  const registry = ctx.sync;
  return {
    // Register the session's actor to drive sync for a workspace via a relay. The registry captures
    // the keypair so rounds keep signing after the client disconnects.
    registerSync: authed(async (req: RegisterSyncRequest, caller): Promise<Empty> => {
      await registry.registerSync(req.workspaceId, req.relayUrl, caller.keypair);
      return EMPTY;
    }),
    // Manual trigger: run one sync round for the workspace now (`lode sync now`).
    syncNow: authed(async (req: SyncNowRequest, _caller): Promise<Empty> => {
      await registry.syncNow(req.workspaceId);
      return EMPTY;
    }),
    // Surface the relay URL this runtime registered + the wsId as a share coordinate (host→client).
    shareWorkspace: authed((req: ShareWorkspaceRequest, _caller): WorkspaceCoordinate => {
      const c = registry.shareCoordinate(req.workspaceId);
      return create(WorkspaceCoordinateSchema, {
        relayUrl: c.relayUrl,
        workspaceId: c.workspaceId,
      });
    }),
    // Join a workspace via a share coordinate: ensure it exists locally, register, directed-fetch the
    // membership roster, and auto-fire a content round.
    joinWorkspace: authed(async (req: JoinWorkspaceRequest, caller): Promise<Empty> => {
      const c = req.coordinate;
      if (!c) {
        throw new Error("joinWorkspace: missing coordinate");
      }
      await registry.joinWorkspace(c.workspaceId, c.relayUrl, caller.keypair);
      return EMPTY;
    }),
  };
}
