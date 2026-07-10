import type { CloneRefRequest, CreateRefRequest, NodeOccurrenceWire } from "@lode/protocol/proto";
import { cloneOccurrence, createReference } from "../domain/node/node.js";
import { authed } from "../handler.js";
import type { AppContext } from "./wire/context.js";
import { runMutation } from "./wire/mutation.js";
import { nodeToProto } from "./wire/wire-node.js";

export function createRefHandlers(ctx: AppContext) {
  return {
    createRef: authed(async (req: CreateRefRequest, caller): Promise<NodeOccurrenceWire> => {
      const node = await runMutation(ctx, caller, req.workspaceId, (doc) =>
        createReference(doc, req.targetNodeId, req.parentOccurrenceId, req.index),
      );
      return nodeToProto(node);
    }),

    cloneRef: authed(async (req: CloneRefRequest, caller): Promise<NodeOccurrenceWire> => {
      const node = await runMutation(ctx, caller, req.workspaceId, (doc) =>
        cloneOccurrence(doc, req.occurrenceId, req.parentOccurrenceId, req.index),
      );
      return nodeToProto(node);
    }),
  };
}
