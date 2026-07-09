import type { CloneRefRequest, CreateRefRequest, NodeOccurrenceWire } from "@lode/protocol/proto";
import { cloneOccurrence, createReference } from "../domain/node/node.js";
import type { AppContext } from "./wire/context.js";
import { runMutation } from "./wire/mutation.js";
import { nodeToProto } from "./wire/wire-node.js";

export function createRefHandlers(ctx: AppContext) {
  return {
    createRef: async (req: CreateRefRequest, connectionId: string): Promise<NodeOccurrenceWire> => {
      const node = await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        createReference(doc, req.targetNodeId, req.parentOccurrenceId, req.index),
      );
      return nodeToProto(node);
    },

    cloneRef: async (req: CloneRefRequest, connectionId: string): Promise<NodeOccurrenceWire> => {
      const node = await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        cloneOccurrence(doc, req.occurrenceId, req.parentOccurrenceId, req.index),
      );
      return nodeToProto(node);
    },
  };
}
