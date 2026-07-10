import type { CloneRefRequest, CreateRefRequest, NodeOccurrenceWire } from "@lode/protocol/proto";
import { cloneOccurrence, createReference } from "../domain/node/node.js";
import { authed } from "./handler.js";
import type { CommandDeps } from "./wire/context.js";
import { runMutation } from "./wire/mutation.js";
import { nodeToProto } from "./wire/wire-node.js";

export function createRefHandlers(ctx: CommandDeps) {
  return {
    createRef: authed(async (req: CreateRefRequest, caller): Promise<NodeOccurrenceWire> => {
      const node = await runMutation(ctx, caller, req.workspaceId, (engine) =>
        createReference(engine, req.targetNodeId, req.parentOccurrenceId, req.index),
      );
      return nodeToProto(node);
    }),

    cloneRef: authed(async (req: CloneRefRequest, caller): Promise<NodeOccurrenceWire> => {
      const node = await runMutation(ctx, caller, req.workspaceId, (engine) =>
        cloneOccurrence(engine, req.occurrenceId, req.parentOccurrenceId, req.index),
      );
      return nodeToProto(node);
    }),
  };
}
