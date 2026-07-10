import { create } from "@bufbuild/protobuf";
import { BoolValueSchema, type BoolValue } from "@bufbuild/protobuf/wkt";
import type {
  CanRedoHistoryRequest,
  CanUndoHistoryRequest,
  RedoHistoryRequest,
  UndoHistoryRequest,
} from "@lode/protocol/proto";
import type { Engine } from "../core/index.js";
import type { ResolvedCaller } from "../caller.js";
import { authed, open } from "../handler.js";
import { getEngine, type AppContext } from "./wire/context.js";
import { runMutation } from "./wire/mutation.js";

export function createHistoryHandlers(ctx: AppContext) {
  // undo/redo run through the same envelope as every direct edit (`runMutation`: capture nodeUpdated
  // → persist → broadcast), so subscribers learn about undo/redo-driven changes the same way. An
  // empty stack applies nothing — short-circuit before the envelope to avoid persisting a no-op
  // (runMutation always persists, since most mutations change the doc). Auth is the caller's own
  // contract (the authed handlers below); this helper just receives the resolved caller.
  const undoOrRedo = async (
    req: UndoHistoryRequest | RedoHistoryRequest,
    caller: ResolvedCaller,
    can: (doc: Engine) => boolean,
    apply: (doc: Engine) => Promise<boolean>,
  ): Promise<BoolValue> => {
    const doc = await getEngine(ctx, req.workspaceId);
    if (!can(doc)) {
      return create(BoolValueSchema, { value: false });
    }
    const done = await runMutation(ctx, caller, req.workspaceId, apply);
    return create(BoolValueSchema, { value: done });
  };

  return {
    undoHistory: authed((req: UndoHistoryRequest, caller) =>
      undoOrRedo(
        req,
        caller,
        (doc) => doc.canUndo(),
        (doc) => doc.undo(),
      ),
    ),

    redoHistory: authed((req: RedoHistoryRequest, caller) =>
      undoOrRedo(
        req,
        caller,
        (doc) => doc.canRedo(),
        (doc) => doc.redo(),
      ),
    ),

    canUndoHistory: open(async (req: CanUndoHistoryRequest): Promise<BoolValue> =>
      create(BoolValueSchema, { value: (await getEngine(ctx, req.workspaceId)).canUndo() }),
    ),

    canRedoHistory: open(async (req: CanRedoHistoryRequest): Promise<BoolValue> =>
      create(BoolValueSchema, { value: (await getEngine(ctx, req.workspaceId)).canRedo() }),
    ),
  };
}
