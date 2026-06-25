import { create } from "@bufbuild/protobuf";
import { BoolValueSchema, type BoolValue } from "@bufbuild/protobuf/wkt";
import type {
  CanRedoHistoryRequest,
  CanUndoHistoryRequest,
  RedoHistoryRequest,
  UndoHistoryRequest,
} from "@lode/protocol/proto";
import { getDoc, type AppContext } from "./context.js";

export function createHistoryHandlers(ctx: AppContext) {
  const undoOrRedo = async (
    req: UndoHistoryRequest | RedoHistoryRequest,
    connectionId: string,
    apply: (doc: Awaited<ReturnType<typeof getDoc>>) => boolean,
  ): Promise<BoolValue> => {
    ctx.sessions.requireOrigin(connectionId);
    const doc = await getDoc(ctx, req.workspaceId, req.docId);
    const beforeVersion = doc.getVersion();
    const done = apply(doc);
    if (done) {
      await ctx.workspaces.persistMutation(req.workspaceId, req.docId, beforeVersion);
    }
    return create(BoolValueSchema, { value: done });
  };

  return {
    undoHistory: (req: UndoHistoryRequest, connectionId: string) =>
      undoOrRedo(req, connectionId, (doc) => doc.undo()),

    redoHistory: (req: RedoHistoryRequest, connectionId: string) =>
      undoOrRedo(req, connectionId, (doc) => doc.redo()),

    canUndoHistory: async (req: CanUndoHistoryRequest, _connectionId: string): Promise<BoolValue> =>
      create(BoolValueSchema, { value: (await getDoc(ctx, req.workspaceId, req.docId)).canUndo() }),

    canRedoHistory: async (req: CanRedoHistoryRequest, _connectionId: string): Promise<BoolValue> =>
      create(BoolValueSchema, { value: (await getDoc(ctx, req.workspaceId, req.docId)).canRedo() }),
  };
}
