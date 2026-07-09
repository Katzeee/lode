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

// eslint-disable-next-line max-lines-per-function -- registers the full node RPC handler set; each handler is a thin adapter over Engine.
export function createNodeHandlers(ctx: AppContext) {
  return {
    createPlainNode: async (
      req: CreatePlainNodeRequest,
      connectionId: string,
    ): Promise<NodeOccurrenceWire> => {
      // Single-root (one workspace = one content tree) is structural: `createPlainNode` takes a
      // required parent, and only `createWorkspaceRoot` (called at workspace birth) can root. So
      // every caller — this RPC, in-process, importers — attaches under an existing node.
      const node = await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        createPlainNode(doc, req.parentOccurrenceId, req.index, req.props),
      );
      return nodeToProto(node);
    },

    getNode: async (req: GetNodeRequest, _connectionId: string): Promise<GetNodeResponse> => {
      const doc = await getEngine(ctx, req.workspaceId);
      const node = await doc.getOccurrence(req.occurrenceId);
      return create(GetNodeResponseSchema, { occurrence: node ? nodeToProto(node) : undefined });
    },

    getNodeById: async (
      req: GetNodeByIdRequest,
      _connectionId: string,
    ): Promise<GetNodeResponse> => {
      const doc = await getEngine(ctx, req.workspaceId);
      // Resolve the canonical occurrence, then read it via the OPTIONAL `getOccurrence` so only a
      // missing node maps to an empty response. The canonical lookup throws NotFoundError on a
      // missing node; any OTHER failure (a shard fault, a corrupt entity) propagates for the daemon
      // to map to a real Connect error — the old bare `catch {}` masked those as a silent "no such node".
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
    },

    getNodeChildren: async (
      req: GetNodeChildrenRequest,
      _connectionId: string,
    ): Promise<GetNodeChildrenResponse> => {
      const children = await getSemanticChildren(
        await getEngine(ctx, req.workspaceId),
        req.occurrenceId,
      );
      return create(GetNodeChildrenResponseSchema, { children: children.map(nodeToProto) });
    },

    listRoots: async (req: ListRootsRequest, _connectionId: string): Promise<ListRootsResponse> => {
      const doc = await getEngine(ctx, req.workspaceId);
      const roots = await doc.getRootOccurrences();
      return create(ListRootsResponseSchema, { roots: roots.map(nodeToProto) });
    },

    moveNode: async (req: MoveNodeRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        moveOccurrence(doc, req.occurrenceId, req.parentOccurrenceId, req.index),
      );
      return EMPTY;
    },

    replaceNodeText: async (req: ReplaceNodeTextRequest, connectionId: string): Promise<Empty> => {
      await runMutation(
        ctx,
        connectionId,
        req.workspaceId,
        (doc) => doc.replaceDeltas(req.occurrenceId, deltasFromProto(req.deltas)),
        shardOfOcc(req.occurrenceId),
      );
      return EMPTY;
    },

    setNodeProp: async (req: SetNodePropRequest, connectionId: string): Promise<Empty> => {
      await runMutation(
        ctx,
        connectionId,
        req.workspaceId,
        (doc) => doc.setProp(req.occurrenceId, req.key, fromValue(req.value)),
        shardOfOcc(req.occurrenceId),
      );
      return EMPTY;
    },

    unsetNodeProp: async (req: UnsetNodePropRequest, connectionId: string): Promise<Empty> => {
      await runMutation(
        ctx,
        connectionId,
        req.workspaceId,
        (doc) => doc.unsetProp(req.occurrenceId, req.key),
        shardOfOcc(req.occurrenceId),
      );
      return EMPTY;
    },

    setOccurrenceProp: async (
      req: SetOccurrencePropRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        doc.setOccurrenceProp(req.occurrenceId, req.key, fromValue(req.value)),
      );
      return EMPTY;
    },

    unsetOccurrenceProp: async (
      req: UnsetOccurrencePropRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        doc.unsetOccurrenceProp(req.occurrenceId, req.key),
      );
      return EMPTY;
    },

    removeNodeOccurrence: async (
      req: RemoveNodeOccurrenceRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        removeOccurrence(doc, req.occurrenceId),
      );
      return EMPTY;
    },

    hardDeleteNode: async (req: HardDeleteNodeRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        hardDeleteNodeCore(doc, req.nodeId),
      );
      return EMPTY;
    },

    promoteCanonicalNode: async (
      req: PromoteCanonicalNodeRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(
        ctx,
        connectionId,
        req.workspaceId,
        (doc) => promoteCanonicalOccurrence(doc, req.nodeId, req.occurrenceId),
        () => [req.nodeId],
      );
      return EMPTY;
    },
  };
}
