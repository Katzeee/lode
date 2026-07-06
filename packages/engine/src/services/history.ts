import { create } from "@bufbuild/protobuf";
import { BoolValueSchema, type BoolValue } from "@bufbuild/protobuf/wkt";
import type {
  CanRedoHistoryRequest,
  CanUndoHistoryRequest,
  RedoHistoryRequest,
  UndoHistoryRequest,
} from "@lode/protocol/proto";
import type { Engine } from "../core/index.js";
import { getEngine, type AppContext } from "./context.js";
import { runMutation } from "./mutation.js";

export function createHistoryHandlers(ctx: AppContext) {
  // undo/redo run through the same envelope as every direct edit (`runMutation`: origin gate →
  // capture nodeUpdated → persist → broadcast), so subscribers learn about undo/redo-driven
  // changes the same way. An empty stack applies nothing — short-circuit before the envelope to
  // avoid persisting a no-op (runMutation always persists, since most mutations change the doc).
  const undoOrRedo = async (
    req: UndoHistoryRequest | RedoHistoryRequest,
    connectionId: string,
    can: (doc: Engine) => boolean,
    apply: (doc: Engine) => boolean,
  ): Promise<BoolValue> => {
    ctx.sessions.requireOrigin(connectionId);
    const doc = await getEngine(ctx, req.workspaceId);
    if (!can(doc)) {
      return create(BoolValueSchema, { value: false });
    }
    const done = await runMutation(ctx, connectionId, req.workspaceId, apply);
    return create(BoolValueSchema, { value: done });
  };

  return {
    undoHistory: (req: UndoHistoryRequest, connectionId: string) =>
      undoOrRedo(
        req,
        connectionId,
        (doc) => doc.canUndo(),
        (doc) => doc.undo(),
      ),

    redoHistory: (req: RedoHistoryRequest, connectionId: string) =>
      undoOrRedo(
        req,
        connectionId,
        (doc) => doc.canRedo(),
        (doc) => doc.redo(),
      ),

    canUndoHistory: async (req: CanUndoHistoryRequest, _connectionId: string): Promise<BoolValue> =>
      create(BoolValueSchema, { value: (await getEngine(ctx, req.workspaceId)).canUndo() }),

    canRedoHistory: async (req: CanRedoHistoryRequest, _connectionId: string): Promise<BoolValue> =>
      create(BoolValueSchema, { value: (await getEngine(ctx, req.workspaceId)).canRedo() }),
  };
}
