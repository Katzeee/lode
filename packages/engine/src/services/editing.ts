import { create } from "@bufbuild/protobuf";
import { type Empty } from "@bufbuild/protobuf/wkt";
import {
  PasteNodesResultSchema,
  type DuplicateNodeRequest,
  type IndentRequest,
  type MoveSiblingRequest,
  type NodeOccurrenceRef,
  type OutdentRequest,
  type PasteNodesRequest,
  type PasteNodesResult,
} from "@lode/protocol/proto";
import { duplicate, paste } from "../domain/editing/clipboard.js";
import { indent, moveSibling, outdent } from "../domain/editing/structure.js";
import { authed } from "../handler.js";
import type { AppContext } from "./wire/context.js";
import { EMPTY } from "./wire/empty.js";
import { identityToProto } from "./wire/mappers.js";
import { runMutation } from "./wire/mutation.js";

// RPC adapters for the composite/intent editing ops. Each maps 1:1 to a domain/editing op; the
// domain already groups the whole intent as one undo step, so runMutation records a single
// before/after pair per call.
export function createEditingHandlers(ctx: AppContext) {
  return {
    pasteNodes: authed(async (req: PasteNodesRequest, caller): Promise<PasteNodesResult> => {
      const created = await runMutation(ctx, caller, req.workspaceId, (doc) =>
        paste(doc, req.sourceOccurrenceIds, req.targetParentOccurrenceId, req.index),
      );
      return create(PasteNodesResultSchema, { occurrences: created.map(identityToProto) });
    }),

    duplicateNode: authed(async (req: DuplicateNodeRequest, caller): Promise<NodeOccurrenceRef> => {
      const clone = await runMutation(ctx, caller, req.workspaceId, (doc) =>
        duplicate(doc, req.occurrenceId),
      );
      return identityToProto(clone);
    }),

    indentNodes: authed(async (req: IndentRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) => indent(doc, req.occurrenceIds));
      return EMPTY;
    }),

    outdentNode: authed(async (req: OutdentRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) => outdent(doc, req.occurrenceId));
      return EMPTY;
    }),

    moveSiblingNode: authed(async (req: MoveSiblingRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) =>
        moveSibling(doc, req.occurrenceId, req.up ? -1 : 1),
      );
      return EMPTY;
    }),
  };
}
