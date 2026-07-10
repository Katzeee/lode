import { create } from "@bufbuild/protobuf";
import { type Empty } from "@bufbuild/protobuf/wkt";
import {
  GetNodeChildrenResponseSchema,
  GetNodeResponseSchema,
  ListRootsResponseSchema,
  type CreatePlainNodeRequest,
  type GetNodeByIdRequest,
  type GetNodeChildrenRequest,
  type GetNodeChildrenResponse,
  type GetNodeRequest,
  type GetNodeResponse,
  type HardDeleteNodeRequest,
  type ListRootsRequest,
  type ListRootsResponse,
  type MoveNodeRequest,
  type NodeOccurrenceWire,
  type PromoteCanonicalNodeRequest,
  type RemoveNodeOccurrenceRequest,
  type ReplaceNodeTextRequest,
  type SetNodePropRequest,
  type SetOccurrencePropRequest,
  type UnsetNodePropRequest,
  type UnsetOccurrencePropRequest,
} from "@lode/protocol/proto";
import {
  createPlainNode,
  getSemanticChildren,
  hardDeleteNode as hardDeleteNodeCore,
  moveOccurrence,
  promoteCanonicalOccurrence,
  removeOccurrence,
} from "../domain/node/node.js";
import { authed, open } from "../handler.js";
import { getEngine, type AppContext } from "./wire/context.js";
import { EMPTY } from "./wire/empty.js";
import { runMutation } from "./wire/mutation.js";
import { fromValue } from "./wire/struct.js";
import { deltasFromProto, nodeToProto } from "./wire/wire-node.js";
import { NotFoundError } from "../errors.js";
import type { Engine, NodeId, OccurrenceId } from "../core/index.js";

/** Working set for an occurrence-targeted mutation: the node's one owning shard, derived tree-only
 *  via `getOccurrenceStruct` (no shard fault). Used as `runMutation`'s `workingSet` so the op pins
 *  its shard resident up front (operation consistency + no fault/evict thrash). */
const shardOfOcc =
  (occ: OccurrenceId) =>
  (doc: Engine): readonly NodeId[] => {
    const nodeId = doc.getOccurrenceStruct(occ)?.nodeId;
    return nodeId ? [nodeId] : [];
  };

// eslint-disable-next-line max-lines-per-function -- registers the full node RPC handler set; each handler is a thin authed()/open() adapter over Engine.
export function createNodeHandlers(ctx: AppContext) {
  return {
    createPlainNode: authed(
      async (req: CreatePlainNodeRequest, caller): Promise<NodeOccurrenceWire> => {
        const node = await runMutation(ctx, caller, req.workspaceId, (doc) =>
          createPlainNode(doc, req.parentOccurrenceId, req.index, req.props),
        );
        return nodeToProto(node);
      },
    ),

    getNode: open(async (req: GetNodeRequest): Promise<GetNodeResponse> => {
      const doc = await getEngine(ctx, req.workspaceId);
      const node = await doc.getOccurrence(req.occurrenceId);
      return create(GetNodeResponseSchema, { occurrence: node ? nodeToProto(node) : undefined });
    }),

    getNodeById: open(async (req: GetNodeByIdRequest): Promise<GetNodeResponse> => {
      const doc = await getEngine(ctx, req.workspaceId);
      let canonicalOccurrenceId: string;
      try {
        canonicalOccurrenceId = await doc.getCanonicalOccurrenceId(req.nodeId);
      } catch (e) {
        if (e instanceof NotFoundError) {
          return create(GetNodeResponseSchema, {});
        }
        throw e;
      }
      const occurrence = await doc.getOccurrence(canonicalOccurrenceId);
      return create(GetNodeResponseSchema, {
        occurrence: occurrence ? nodeToProto(occurrence) : undefined,
      });
    }),

    getNodeChildren: open(async (req: GetNodeChildrenRequest): Promise<GetNodeChildrenResponse> => {
      const children = await getSemanticChildren(
        await getEngine(ctx, req.workspaceId),
        req.occurrenceId,
      );
      return create(GetNodeChildrenResponseSchema, { children: children.map(nodeToProto) });
    }),

    listRoots: open(async (req: ListRootsRequest): Promise<ListRootsResponse> => {
      const doc = await getEngine(ctx, req.workspaceId);
      const roots = await doc.getRootOccurrences();
      return create(ListRootsResponseSchema, { roots: roots.map(nodeToProto) });
    }),

    moveNode: authed(async (req: MoveNodeRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) =>
        moveOccurrence(doc, req.occurrenceId, req.parentOccurrenceId, req.index),
      );
      return EMPTY;
    }),

    replaceNodeText: authed(async (req: ReplaceNodeTextRequest, caller): Promise<Empty> => {
      await runMutation(
        ctx,
        caller,
        req.workspaceId,
        (doc) => doc.replaceDeltas(req.occurrenceId, deltasFromProto(req.deltas)),
        shardOfOcc(req.occurrenceId),
      );
      return EMPTY;
    }),

    setNodeProp: authed(async (req: SetNodePropRequest, caller): Promise<Empty> => {
      await runMutation(
        ctx,
        caller,
        req.workspaceId,
        (doc) => doc.setProp(req.occurrenceId, req.key, fromValue(req.value)),
        shardOfOcc(req.occurrenceId),
      );
      return EMPTY;
    }),

    unsetNodeProp: authed(async (req: UnsetNodePropRequest, caller): Promise<Empty> => {
      await runMutation(
        ctx,
        caller,
        req.workspaceId,
        (doc) => doc.unsetProp(req.occurrenceId, req.key),
        shardOfOcc(req.occurrenceId),
      );
      return EMPTY;
    }),

    setOccurrenceProp: authed(async (req: SetOccurrencePropRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) =>
        doc.setOccurrenceProp(req.occurrenceId, req.key, fromValue(req.value)),
      );
      return EMPTY;
    }),

    unsetOccurrenceProp: authed(async (req: UnsetOccurrencePropRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) =>
        doc.unsetOccurrenceProp(req.occurrenceId, req.key),
      );
      return EMPTY;
    }),

    removeNodeOccurrence: authed(
      async (req: RemoveNodeOccurrenceRequest, caller): Promise<Empty> => {
        await runMutation(ctx, caller, req.workspaceId, (doc) =>
          removeOccurrence(doc, req.occurrenceId),
        );
        return EMPTY;
      },
    ),

    hardDeleteNode: authed(async (req: HardDeleteNodeRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (doc) => hardDeleteNodeCore(doc, req.nodeId));
      return EMPTY;
    }),

    promoteCanonicalNode: authed(
      async (req: PromoteCanonicalNodeRequest, caller): Promise<Empty> => {
        await runMutation(
          ctx,
          caller,
          req.workspaceId,
          (doc) => promoteCanonicalOccurrence(doc, req.nodeId, req.occurrenceId),
          () => [req.nodeId],
        );
        return EMPTY;
      },
    ),
  };
}
