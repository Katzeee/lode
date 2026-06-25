import { create } from "@bufbuild/protobuf";
import { BoolValueSchema, StringValueSchema, type Empty } from "@bufbuild/protobuf/wkt";
import {
  ListWorkspaceDocsResponseSchema,
  ListWorkspacesResponseSchema,
  WorkspaceInfoSchema,
  type CreateWorkspaceDocRequest,
  type CreateWorkspaceRequest,
  type ListWorkspaceDocsRequest,
  type ListWorkspaceDocsResponse,
  type ListWorkspacesResponse,
  type RemoveWorkspaceDocRequest,
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
      const info = await ctx.workspaces.createWorkspace({
        displayName: req.displayName,
        ...(req.workspaceId === undefined ? {} : { workspaceId: req.workspaceId }),
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

    createWorkspaceDoc: async (req: CreateWorkspaceDocRequest, connectionId: string) => {
      ctx.sessions.requireOrigin(connectionId);
      const docId = await ctx.workspaces.createDoc({
        workspaceId: req.workspaceId,
        ...(req.docId === undefined ? {} : { docId: req.docId }),
        ...(req.displayName === undefined ? {} : { displayName: req.displayName }),
      });
      return create(StringValueSchema, { value: docId });
    },

    listWorkspaceDocs: async (
      req: ListWorkspaceDocsRequest,
      _connectionId: string,
    ): Promise<ListWorkspaceDocsResponse> =>
      create(ListWorkspaceDocsResponseSchema, {
        docIds: await ctx.workspaces.listDocs(req.workspaceId),
      }),

    removeWorkspaceDoc: async (req: RemoveWorkspaceDocRequest, connectionId: string) => {
      ctx.sessions.requireOrigin(connectionId);
      return create(BoolValueSchema, {
        value: await ctx.workspaces.removeDoc(req.workspaceId, req.docId),
      });
    },
  };
}
