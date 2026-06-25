import { create } from "@bufbuild/protobuf";
import { type Empty } from "@bufbuild/protobuf/wkt";
import {
  GetNodeChildrenResponseSchema,
  GetNodeResponseSchema,
  type CreatePlainNodeRequest,
  type GetNodeByIdRequest,
  type GetNodeChildrenRequest,
  type GetNodeChildrenResponse,
  type GetNodeRequest,
  type GetNodeResponse,
  type HardDeleteNodeRequest,
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
import { getDoc, type AppContext } from "./context.js";
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
      const node = await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) =>
        createPlainNodeCore(doc, req.parentOccurrenceId ?? null, req.index, req.props),
      );
      return nodeToProto(node);
    },

    getNode: async (req: GetNodeRequest, _connectionId: string): Promise<GetNodeResponse> => {
      const node = (await getDoc(ctx, req.workspaceId, req.docId)).getOccurrence(req.occurrenceId);
      return create(GetNodeResponseSchema, { occurrence: node ? nodeToProto(node) : undefined });
    },

    getNodeById: async (
      req: GetNodeByIdRequest,
      _connectionId: string,
    ): Promise<GetNodeResponse> => {
      const doc = await getDoc(ctx, req.workspaceId, req.docId);
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
      const children = getSemanticChildren(
        await getDoc(ctx, req.workspaceId, req.docId),
        req.occurrenceId,
      );
      return create(GetNodeChildrenResponseSchema, { children: children.map(nodeToProto) });
    },

    moveNode: async (req: MoveNodeRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) => {
        assertNotActiveManagedChild(doc, req.occurrenceId);
        moveOccurrence(doc, req.occurrenceId, req.parentOccurrenceId ?? null, req.index);
      });
      return EMPTY;
    },

    replaceNodeText: async (req: ReplaceNodeTextRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) =>
        doc.replaceDeltas(req.occurrenceId, deltasFromProto(req.deltas)),
      );
      return EMPTY;
    },

    setNodeProp: async (req: SetNodePropRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) =>
        doc.setProp(req.occurrenceId, req.key, fromValue(req.value)),
      );
      return EMPTY;
    },

    unsetNodeProp: async (req: UnsetNodePropRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) =>
        doc.unsetProp(req.occurrenceId, req.key),
      );
      return EMPTY;
    },

    setOccurrenceProp: async (
      req: SetOccurrencePropRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) =>
        doc.setOccurrenceProp(req.occurrenceId, req.key, fromValue(req.value)),
      );
      return EMPTY;
    },

    unsetOccurrenceProp: async (
      req: UnsetOccurrencePropRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) =>
        doc.unsetOccurrenceProp(req.occurrenceId, req.key),
      );
      return EMPTY;
    },

    removeNodeOccurrence: async (
      req: RemoveNodeOccurrenceRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) => {
        assertNotActiveManagedChild(doc, req.occurrenceId);
        doc.removeOccurrence(req.occurrenceId);
      });
      return EMPTY;
    },

    hardDeleteNode: async (req: HardDeleteNodeRequest, connectionId: string): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) => {
        assertNodeHardDeleteAllowed(doc, req.nodeId);
        hardDeleteNodeCore(doc, req.nodeId);
      });
      return EMPTY;
    },

    promoteCanonicalNode: async (
      req: PromoteCanonicalNodeRequest,
      connectionId: string,
    ): Promise<Empty> => {
      await runMutation(ctx, connectionId, req.workspaceId, req.docId, (doc) =>
        promoteCanonicalOccurrence(doc, req.nodeId, req.occurrenceId),
      );
      return EMPTY;
    },
  };
}
