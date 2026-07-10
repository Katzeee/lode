import { create } from "@bufbuild/protobuf";
import { BoolValueSchema } from "@bufbuild/protobuf/wkt";
import {
  ListWorkspacesResponseSchema,
  WorkspaceInfoSchema,
  type CreateWorkspaceRequest,
  type ForkWorkspaceRequest,
  type ListWorkspacesResponse,
  type RemoveWorkspaceRequest,
  type WorkspaceInfo,
} from "@lode/protocol/proto";
import { authed, open } from "./handler.js";
import type { CommandDeps } from "./wire/context.js";

export function createWorkspaceHandlers(ctx: CommandDeps) {
  return {
    createWorkspace: authed(async (req: CreateWorkspaceRequest, caller): Promise<WorkspaceInfo> => {
      // The creator is the owner: init the membership root with the caller's keypair.
      const info = await ctx.workspaces.createWorkspace({
        displayName: req.displayName,
        ...(req.workspaceId === undefined ? {} : { workspaceId: req.workspaceId }),
        ...(req.peerName === undefined ? {} : { peerName: req.peerName }),
        actorKeypair: caller.keypair,
      });
      return create(WorkspaceInfoSchema, {
        workspaceId: info.workspaceId,
        displayName: info.displayName,
      });
    }),

    // Recovery (design §13): copy the source workspace's content into a NEW workspace where the
    // caller is the owner. Fresh wsId + empty membership log + a root signed by the caller's actor.
    // Used when kicked, owner-lost, or rogue-owner; the source is left untouched. The caller's
    // keypair (the forker) signs the fresh root — forker = new owner.
    forkWorkspace: authed(async (req: ForkWorkspaceRequest, caller): Promise<WorkspaceInfo> => {
      const info = await ctx.workspaces.forkWorkspace({
        sourceWorkspaceId: req.workspaceId,
        displayName: req.displayName,
        ...(req.peerName === undefined ? {} : { peerName: req.peerName }),
        actorKeypair: caller.keypair,
      });
      return create(WorkspaceInfoSchema, {
        workspaceId: info.workspaceId,
        displayName: info.displayName,
      });
    }),

    listWorkspaces: open(async (): Promise<ListWorkspacesResponse> => {
      const workspaces = await ctx.workspaces.listWorkspaces();
      return create(ListWorkspacesResponseSchema, {
        workspaces: workspaces.map((info) =>
          create(WorkspaceInfoSchema, {
            workspaceId: info.workspaceId,
            displayName: info.displayName,
          }),
        ),
      });
    }),

    removeWorkspace: authed(async (req: RemoveWorkspaceRequest) =>
      create(BoolValueSchema, { value: await ctx.workspaces.removeWorkspace(req.workspaceId) }),
    ),
  };
}
