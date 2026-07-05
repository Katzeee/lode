import { create } from "@bufbuild/protobuf";
import { BoolValueSchema, type Empty } from "@bufbuild/protobuf/wkt";
import {
  ListWorkspacesResponseSchema,
  WorkspaceInfoSchema,
  type CreateWorkspaceRequest,
  type ForkWorkspaceRequest,
  type ListWorkspacesResponse,
  type RemoveWorkspaceRequest,
  type WorkspaceInfo,
} from "@lode/protocol/proto";
import type { AppContext } from "./context.js";

export function createWorkspaceHandlers(ctx: AppContext) {
  return {
    createWorkspace: async (
      req: CreateWorkspaceRequest,
      connectionId: string,
    ): Promise<WorkspaceInfo> => {
      ctx.sessions.requireOrigin(connectionId);
      // The creator is the owner: init the membership root with the session actor's keypair.
      const { keypair } = ctx.sessions.getActorKeypair(connectionId);
      const info = await ctx.workspaces.createWorkspace({
        displayName: req.displayName,
        ...(req.workspaceId === undefined ? {} : { workspaceId: req.workspaceId }),
        ...(req.peerName === undefined ? {} : { peerName: req.peerName }),
        actorKeypair: keypair,
      });
      return create(WorkspaceInfoSchema, {
        workspaceId: info.workspaceId,
        displayName: info.displayName,
      });
    },

    // Recovery (design §13): copy the source workspace's content into a NEW workspace where the
    // caller is the owner. Fresh wsId + empty membership log + a root signed by the caller's actor.
    // Used when kicked, owner-lost, or rogue-owner; the source is left untouched. The caller's
    // keypair (the forker) signs the fresh root — forker = new owner.
    forkWorkspace: async (
      req: ForkWorkspaceRequest,
      connectionId: string,
    ): Promise<WorkspaceInfo> => {
      ctx.sessions.requireOrigin(connectionId);
      const { keypair } = ctx.sessions.getActorKeypair(connectionId);
      const info = await ctx.workspaces.forkWorkspace({
        sourceWorkspaceId: req.workspaceId,
        displayName: req.displayName,
        ...(req.peerName === undefined ? {} : { peerName: req.peerName }),
        actorKeypair: keypair,
      });
      return create(WorkspaceInfoSchema, {
        workspaceId: info.workspaceId,
        displayName: info.displayName,
      });
    },

    listWorkspaces: async (_req: Empty, _connectionId: string): Promise<ListWorkspacesResponse> => {
      const workspaces = await ctx.workspaces.listWorkspaces();
      return create(ListWorkspacesResponseSchema, {
        workspaces: workspaces.map((info) =>
          create(WorkspaceInfoSchema, {
            workspaceId: info.workspaceId,
            displayName: info.displayName,
          }),
        ),
      });
    },

    removeWorkspace: async (req: RemoveWorkspaceRequest, connectionId: string) => {
      ctx.sessions.requireOrigin(connectionId);
      return create(BoolValueSchema, {
        value: await ctx.workspaces.removeWorkspace(req.workspaceId),
      });
    },
  };
}
