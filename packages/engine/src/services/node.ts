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
import { EMPTY } from "./empty.js";
import { runMutation } from "./mutation.js";
import { fromValue } from "./struct.js";
import { deltasFromProto, nodeToProto } from "./wire-node.js";

export function createNodeHandlers(ctx: AppContext) {
  return {
    createPlainNode: async (
      req: CreatePlainNodeRequest,
      connectionId: string,
    ): Promise<NodeOccurrenceWire> => {
      // The service is a thin RPC adapter over the forest core (AGENTS.md: services own no domain
      // semantics). Single-root is a PRODUCT policy, so it is enforced at the product surface (the
      // CLI's `node create` requires `--parent-occ`); the owner-bootstrap root is seeded directly via
      // the domain primitive in `createWorkspace`. This RPC stays a forest pass-through (null parent =
      // root), which the engine/CRUD tests rely on.
      const node = await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        createPlainNodeCore(doc, req.parentOccurrenceId ?? null, req.index, req.props),
      );
      return nodeToProto(node);
    },

    getNode: async (req: GetNodeRequest, _connectionId: string): Promise<GetNodeResponse> => {
      const node = (await getEngine(ctx, req.workspaceId)).getOccurrence(req.occurrenceId);
      return create(GetNodeResponseSchema, { occurrence: node ? nodeToProto(node) : undefined });
    },

    getNodeById: async (
      req: GetNodeByIdRequest,
      _connectionId: string,
    ): Promise<GetNodeResponse> => {
      const doc = await getEngine(ctx, req.workspaceId);
      try {
        return create(GetNodeResponseSchema, {
          occurrence: nodeToProto(doc.mustGetOccurrence(doc.getCanonicalOccurrenceId(req.nodeId))),
        });
      } catch {
        return create(GetNodeResponseSchema, {});
      }
    },

    getNodeChildren: async (
      req: GetNodeChildrenRequest,
      _connectionId: string,
    ): Promise<GetNodeChildrenResponse> => {
      const children = getSemanticChildren(await getEngine(ctx, req.workspaceId), req.occurrenceId);
      return create(GetNodeChildrenResponseSchema, { children: children.map(nodeToProto) });
    },

    listRoots: async (req: ListRootsRequest, _connectionId: string): Promise<ListRootsResponse> => {
      const roots = (await getEngine(ctx, req.workspaceId)).getRootOccurrences();
      return create(ListRootsResponseSchema, { roots: roots.map(nodeToProto) });
    },

    moveNode: async (req: MoveNodeRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) => {
        assertNotActiveManagedChild(doc, req.occurrenceId);
        moveOccurrence(doc, req.occurrenceId, req.parentOccurrenceId ?? null, req.index);
      });
      return EMPTY;
    },

    replaceNodeText: async (req: ReplaceNodeTextRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        doc.replaceDeltas(req.occurrenceId, deltasFromProto(req.deltas)),
      );
      return EMPTY;
    },

    setNodeProp: async (req: SetNodePropRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        doc.setProp(req.occurrenceId, req.key, fromValue(req.value)),
      );
      return EMPTY;
    },

    unsetNodeProp: async (req: UnsetNodePropRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        doc.unsetProp(req.occurrenceId, req.key),
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
      await runMutation(ctx, connectionId, req.workspaceId, (doc) => {
        assertNotActiveManagedChild(doc, req.occurrenceId);
        doc.removeOccurrence(req.occurrenceId);
      });
      return EMPTY;
    },

    hardDeleteNode: async (req: HardDeleteNodeRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) => {
        assertNodeHardDeleteAllowed(doc, req.nodeId);
        hardDeleteNodeCore(doc, req.nodeId);
      });
      return EMPTY;
    },

    promoteCanonicalNode: async (
      req: PromoteCanonicalNodeRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        promoteCanonicalOccurrence(doc, req.nodeId, req.occurrenceId),
      );
      return EMPTY;
    },
  };
}
