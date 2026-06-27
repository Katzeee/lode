import { create } from "@bufbuild/protobuf";
import {
  SchemaChangeResultSchema,
  type ApplySchemaRequest,
  type CreateSchemaRequest,
  type NodeOccurrenceRef,
  type ReconcileSchemaRequest,
  type RemoveSchemaRequest,
  type SchemaChangeResult,
} from "@lode/protocol/proto";
import {
  applySchema,
  createSchema,
  reconcileSchema,
  removeSchema,
  type SchemaChangeResult as DomainSchemaChangeResult,
} from "../domain/schema.js";
import type { AppContext } from "./context.js";
import { changeToProto, identityToProto, nodeRefToProto } from "./mappers.js";
import { runMutation } from "./mutation.js";

export function createSchemaHandlers(ctx: AppContext) {
  const toResult = (result: DomainSchemaChangeResult): SchemaChangeResult =>
    create(SchemaChangeResultSchema, {
      target: identityToProto(result.target),
      ...(result.schema === undefined ? {} : { schema: nodeRefToProto(result.schema.nodeId) }),
      changes: result.changes.map(changeToProto),
    });

  return {
    createSchema: async (
      req: CreateSchemaRequest,
      connectionId: string,
    ): Promise<NodeOccurrenceRef> => {
      const identity = await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
        createSchema(doc, req.name, req.parentOccurrenceId ?? null),
      );
      return identityToProto(identity);
    },

    applySchema: async (
      req: ApplySchemaRequest,
      connectionId: string,
    ): Promise<SchemaChangeResult> =>
      toResult(
        await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
          applySchema(doc, req.targetOccurrenceId, req.schemaNodeId),
        ),
      ),

    removeSchema: async (
      req: RemoveSchemaRequest,
      connectionId: string,
    ): Promise<SchemaChangeResult> =>
      toResult(
        await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
          removeSchema(doc, req.targetOccurrenceId, req.schemaNodeId),
        ),
      ),

    reconcileSchema: async (
      req: ReconcileSchemaRequest,
      connectionId: string,
    ): Promise<SchemaChangeResult> =>
      toResult(
        await runMutation(ctx, connectionId, req.workspaceId, (doc) =>
          reconcileSchema(doc, req.targetOccurrenceId),
        ),
      ),
  };
}
