import { create } from "@bufbuild/protobuf";
import { BoolValueSchema, type BoolValue } from "@bufbuild/protobuf/wkt";
import type {
  CanRedoHistoryRequest,
  CanUndoHistoryRequest,
  RedoHistoryRequest,
  UndoHistoryRequest,
} from "@lode/protocol/proto";
import type { Engine } from "../core/index.js";
import type { ResolvedCaller } from "../runtime/identity/caller.js";
import { authed, open } from "./handler.js";
import { readWorkspace, type CommandDeps } from "./wire/context.js";
import { runMutation } from "./wire/mutation.js";

export function createHistoryHandlers(ctx: CommandDeps) {
  // undo/redo run through the same envelope as every direct edit (`runMutation`: capture effects →
  // flush → broadcast), so subscribers learn about undo/redo-driven changes the same way. An empty
  // stack applies nothing — engine.undo()/redo() return false on empty and capture no effects, so the
  // Committed broadcast is skipped naturally; no separate canUndo()/canRedo() gate is needed. Auth is
  // the caller's own contract (the authed handlers below); this helper just receives the resolved
  // caller.
  const undoOrRedo = async (
    req: UndoHistoryRequest | RedoHistoryRequest,
    caller: ResolvedCaller,
    apply: (engine: Engine) => Promise<boolean>,
  ): Promise<BoolValue> => {
    const done = await runMutation(ctx, caller, req.workspaceId, apply);
    return create(BoolValueSchema, { value: done });
  };

  return {
    undoHistory: authed((req: UndoHistoryRequest, caller) =>
      undoOrRedo(req, caller, (engine) => engine.undo()),
    ),

    redoHistory: authed((req: RedoHistoryRequest, caller) =>
      undoOrRedo(req, caller, (engine) => engine.redo()),
    ),

    canUndoHistory: open(async (req: CanUndoHistoryRequest): Promise<BoolValue> =>
      create(BoolValueSchema, {
        value: await readWorkspace(ctx, req.workspaceId, (engine) => engine.canUndo()),
      }),
    ),

    canRedoHistory: open(async (req: CanRedoHistoryRequest): Promise<BoolValue> =>
      create(BoolValueSchema, {
        value: await readWorkspace(ctx, req.workspaceId, (engine) => engine.canRedo()),
      }),
    ),
  };
}
