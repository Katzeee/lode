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
import { authed, open } from "./handler.js";
import { readWorkspace, type CommandDeps } from "./wire/context.js";
import { EMPTY } from "./wire/empty.js";
import { runMutation } from "./wire/mutation.js";
import { fromValue } from "./wire/struct.js";
import { deltasFromProto, nodeToProto } from "./wire/wire-node.js";
import { NotFoundError } from "../errors/index.js";
import type { Engine, NodeId, OccurrenceId } from "../core/index.js";

/** Working set for an occurrence-targeted mutation: the node's one owning shard, derived tree-only
 *  via `getOccurrenceStruct` (no shard fault). Used as `runMutation`'s `workingSet` so the op pins
 *  its shard resident up front (operation consistency + no fault/evict thrash). */
const shardOfOcc =
  (occ: OccurrenceId) =>
  (engine: Engine): readonly NodeId[] => {
    const nodeId = engine.getOccurrenceStruct(occ)?.nodeId;
    return nodeId ? [nodeId] : [];
  };

// eslint-disable-next-line max-lines-per-function -- registers the full node RPC handler set; each handler is a thin authed()/open() adapter over Engine.
export function createNodeHandlers(ctx: CommandDeps) {
  return {
    createPlainNode: authed(
      async (req: CreatePlainNodeRequest, caller): Promise<NodeOccurrenceWire> => {
        const node = await runMutation(ctx, caller, req.workspaceId, (engine) =>
          createPlainNode(engine, req.parentOccurrenceId, req.index, req.props),
        );
        return nodeToProto(node);
      },
    ),

    getNode: open(async (req: GetNodeRequest): Promise<GetNodeResponse> => {
      const node = await readWorkspace(ctx, req.workspaceId, (engine) =>
        engine.getOccurrence(req.occurrenceId),
      );
      return create(GetNodeResponseSchema, { occurrence: node ? nodeToProto(node) : undefined });
    }),

    getNodeById: open(async (req: GetNodeByIdRequest): Promise<GetNodeResponse> => {
      const occurrence = await readWorkspace(ctx, req.workspaceId, async (engine) => {
        let canonicalOccurrenceId: string;
        try {
          canonicalOccurrenceId = await engine.getCanonicalOccurrenceId(req.nodeId);
        } catch (e) {
          if (e instanceof NotFoundError) {
            return undefined;
          }
          throw e;
        }
        return engine.getOccurrence(canonicalOccurrenceId);
      });
      return create(GetNodeResponseSchema, {
        occurrence: occurrence ? nodeToProto(occurrence) : undefined,
      });
    }),

    getNodeChildren: open(async (req: GetNodeChildrenRequest): Promise<GetNodeChildrenResponse> => {
      const children = await readWorkspace(ctx, req.workspaceId, (engine) =>
        getSemanticChildren(engine, req.occurrenceId),
      );
      return create(GetNodeChildrenResponseSchema, { children: children.map(nodeToProto) });
    }),

    listRoots: open(async (req: ListRootsRequest): Promise<ListRootsResponse> => {
      const roots = await readWorkspace(ctx, req.workspaceId, (engine) =>
        engine.getRootOccurrences(),
      );
      return create(ListRootsResponseSchema, { roots: roots.map(nodeToProto) });
    }),

    moveNode: authed(async (req: MoveNodeRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (engine) =>
        moveOccurrence(engine, req.occurrenceId, req.parentOccurrenceId, req.index),
      );
      return EMPTY;
    }),

    replaceNodeText: authed(async (req: ReplaceNodeTextRequest, caller): Promise<Empty> => {
      await runMutation(
        ctx,
        caller,
        req.workspaceId,
        (engine) => engine.replaceDeltas(req.occurrenceId, deltasFromProto(req.deltas)),
        shardOfOcc(req.occurrenceId),
      );
      return EMPTY;
    }),

    setNodeProp: authed(async (req: SetNodePropRequest, caller): Promise<Empty> => {
      await runMutation(
        ctx,
        caller,
        req.workspaceId,
        (engine) => engine.setProp(req.occurrenceId, req.key, fromValue(req.value)),
        shardOfOcc(req.occurrenceId),
      );
      return EMPTY;
    }),

    unsetNodeProp: authed(async (req: UnsetNodePropRequest, caller): Promise<Empty> => {
      await runMutation(
        ctx,
        caller,
        req.workspaceId,
        (engine) => engine.unsetProp(req.occurrenceId, req.key),
        shardOfOcc(req.occurrenceId),
      );
      return EMPTY;
    }),

    setOccurrenceProp: authed(async (req: SetOccurrencePropRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (engine) =>
        engine.setOccurrenceProp(req.occurrenceId, req.key, fromValue(req.value)),
      );
      return EMPTY;
    }),

    unsetOccurrenceProp: authed(async (req: UnsetOccurrencePropRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (engine) =>
        engine.unsetOccurrenceProp(req.occurrenceId, req.key),
      );
      return EMPTY;
    }),

    removeNodeOccurrence: authed(
      async (req: RemoveNodeOccurrenceRequest, caller): Promise<Empty> => {
        await runMutation(ctx, caller, req.workspaceId, (engine) =>
          removeOccurrence(engine, req.occurrenceId),
        );
        return EMPTY;
      },
    ),

    hardDeleteNode: authed(async (req: HardDeleteNodeRequest, caller): Promise<Empty> => {
      await runMutation(ctx, caller, req.workspaceId, (engine) =>
        hardDeleteNodeCore(engine, req.nodeId),
      );
      return EMPTY;
    }),

    promoteCanonicalNode: authed(
      async (req: PromoteCanonicalNodeRequest, caller): Promise<Empty> => {
        await runMutation(
          ctx,
          caller,
          req.workspaceId,
          (engine) => promoteCanonicalOccurrence(engine, req.nodeId, req.occurrenceId),
          () => [req.nodeId],
        );
        return EMPTY;
      },
    ),
  };
}
