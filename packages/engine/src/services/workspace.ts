import { create } from "@bufbuild/protobuf";
import { BoolValueSchema, type Empty } from "@bufbuild/protobuf/wkt";
import {
  ListWorkspacesResponseSchema,
  WorkspaceInfoSchema,
  type CreateWorkspaceRequest,
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
