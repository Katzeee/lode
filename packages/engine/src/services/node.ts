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
import { assertNodeHardDeleteAllowed } from "../domain/hard-delete-policy.js";
import { assertNotActiveManagedChild } from "../domain/managed-child-policy.js";
import {
  createPlainNode as createPlainNodeCore,
  getSemanticChildren,
  hardDeleteNode as hardDeleteNodeCore,
  moveOccurrence,
  promoteCanonicalOccurrence,
} from "../domain/node.js";
import { getEngine, type AppContext } from "./context.js";
import { DomainInvalidInputError } from "../domain/errors.js";
import { EMPTY } from "./empty.js";
import { runMutation } from "./mutation.js";
import { fromValue } from "./struct.js";
import { deltasFromProto, nodeToProto } from "./wire-node.js";
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

export function createNodeHandlers(ctx: AppContext) {
  return {
    createPlainNode: async (
      req: CreatePlainNodeRequest,
      connectionId: string,
    ): Promise<NodeOccurrenceWire> => {
      // Single-root is a PRODUCT policy (one workspace = one content tree), enforced HERE — the one
      // product-surface funnel for node creation. The engine core stays a forest (BlockSuite/Loro-
      // faithful; engine tests build multi-root trees directly via the domain primitive). The sole
      // sanctioned root is the one `createWorkspace` seeds at birth (owner-gated, directly via the
      // domain primitive — it bypasses this RPC). A null parent means "the workspace's one root," legal
      // only before that root exists; once rooted, every node must attach under it.
      const node = await runMutation(ctx, connectionId, req.workspaceId, async (doc) => {
        if (!req.parentOccurrenceId && (await doc.getRootOccurrences()).length > 0) {
          throw new DomainInvalidInputError(
            "createPlainNode: workspace already has a root; pass parentOccurrenceId to attach under it",
          );
        }
        return createPlainNodeCore(doc, req.parentOccurrenceId ?? null, req.index, req.props);
      });
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
      try {
        const occurrence = await doc.mustGetOccurrence(
          await doc.getCanonicalOccurrenceId(req.nodeId),
        );
        return create(GetNodeResponseSchema, { occurrence: nodeToProto(occurrence) });
      } catch {
        return create(GetNodeResponseSchema, {});
      }
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
      await runMutation(ctx, connectionId, req.workspaceId, async (doc) => {
        await assertNotActiveManagedChild(doc, req.occurrenceId);
        await moveOccurrence(doc, req.occurrenceId, req.parentOccurrenceId ?? null, req.index);
      });
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
      await runMutation(ctx, connectionId, req.workspaceId, async (doc) => {
        await assertNotActiveManagedChild(doc, req.occurrenceId);
        await doc.removeOccurrence(req.occurrenceId);
      });
      return EMPTY;
    },

    hardDeleteNode: async (req: HardDeleteNodeRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, async (doc) => {
        await assertNodeHardDeleteAllowed(doc, req.nodeId);
        await hardDeleteNodeCore(doc, req.nodeId);
      });
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
